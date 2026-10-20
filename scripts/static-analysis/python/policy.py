"""Pure identity and baseline policy. Never imports analyzed source."""
import ast
import hashlib
import io
import json
from pathlib import Path
import re
import tokenize


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def node_text(node):
    return ast.dump(node, include_attributes=False)


class Source:
    def __init__(self, text, filename):
        self.tree = ast.parse(text, filename=filename)
        self.lines = text.splitlines()
        self.tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
        self.parents = {}
        for node in ast.walk(self.tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node

    def containing(self, line, column):
        if line < 1 or line > len(self.lines) or column < 1:
            raise ValueError('Invalid diagnostic location')
        byte_column = len(self.lines[line - 1][:column - 1].encode('utf-8'))
        result = []
        for node in ast.walk(self.tree):
            start = (getattr(node, 'lineno', 0), getattr(node, 'col_offset', 0))
            end = (getattr(node, 'end_lineno', 0) or 0, getattr(node, 'end_col_offset', 0) or 0)
            position = (line, byte_column)
            if start <= position < end or (isinstance(node, ast.stmt) and position == end):
                result.append(node)
        return result

    def identify(self, finding):
        nodes = self.containing(finding['line'], finding['column'])
        declarations = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        owner = '/'.join(node.name for node in nodes if isinstance(node, declarations))
        anchor = ''
        if 'metric' not in finding:
            statements = [node for node in nodes if isinstance(node, ast.stmt)]
            statement = statements[-1] if statements else self.tree
            anchor = [node_text(statement), self.context(statement), self.line_anchor(finding)]
        identity = [finding['file'], finding['rule'], owner, anchor,
                    '' if 'metric' in finding else finding['message']]
        return dict(finding, owner=owner, id=digest(json.dumps(identity)))

    def line_anchor(self, finding):
        ignored = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}
        tokens = [token for token in self.tokens if token.start[0] == finding['line'] and token.type not in ignored]
        before = sum(token.start[1] < finding['column'] - 1 for token in tokens)
        return [[token.string for token in tokens], before]

    def context(self, statement):
        result = []
        node = statement
        while node in self.parents:
            parent = self.parents[node]
            for field, value in ast.iter_fields(parent):
                if isinstance(value, list) and node in value:
                    result.append(field)
                    if node is statement:
                        index = value.index(node)
                        result.extend(digest(node_text(value[i])) for i in [index - 1, index + 1] if 0 <= i < len(value))
            if isinstance(parent, (ast.If, ast.While)):
                result.append(node_text(parent.test))
            if isinstance(parent, ast.ExceptHandler):
                result.append(node_text(parent.type) if parent.type else 'bare-except')
            node = parent
        return result


def unique(findings):
    result = {}
    for finding in findings:
        identity = finding['id']
        if identity in result:
            raise ValueError(f"Ambiguous finding: {finding['file']}:{finding['line']} {finding['rule']}")
        result[identity] = finding
    return result


def compare(findings, baseline, contract):
    if baseline.get('schema') != 1 or baseline.get('contract') != contract:
        raise ValueError('Python baseline config/version/scope mismatch; explicit review required')
    known = unique(baseline['findings'])
    unique(findings)
    return [item for item in findings if item['id'] not in known or
            item.get('metric', 0) > known[item['id']].get('metric', 0)]


def normalize_ruff(data, root, sources):
    if not isinstance(data, list):
        raise ValueError('Invalid Ruff JSON: expected findings array')
    findings = []
    for item in data:
        file = Path(item['filename']).resolve().relative_to(root).as_posix()
        if file not in sources or not item.get('code'):
            raise ValueError('Ruff returned an unknown file or invalid diagnostic')
        result = dict(file=file, rule='ruff/' + item['code'], message=item['message'],
                      severity=2, line=item['location']['row'], column=item['location']['column'])
        if item['code'] == 'C901':
            match = re.search(r'\((\d+) > 8\)', item['message'])
            if not match:
                raise ValueError('Unrecognized Ruff complexity message')
            result['metric'] = int(match[1])
        findings.append(sources[file].identify(result))
    return findings


def radon_blocks(blocks):
    if not isinstance(blocks, list):
        raise ValueError('Invalid Radon blocks')
    for block in blocks:
        if not isinstance(block.get('complexity'), int) or block['complexity'] < 1:
            raise ValueError('Invalid Radon complexity')
        if block['type'] in ('function', 'method'):
            yield block
        yield from radon_blocks(block.get('methods', []))
        yield from radon_blocks(block.get('closures', []))


def normalize_radon(data, sources):
    if not isinstance(data, dict) or set(data) - set(sources):
        raise ValueError('Invalid Radon file coverage')
    findings = {}
    for file, source in sources.items():
        seen = set()
        for block in radon_blocks(data.get(file, [])):
            seen.add(block['lineno'])
            if block['complexity'] <= 8:
                continue
            item = source.identify(dict(file=file, rule='radon/CC', severity=2,
                                        line=block['lineno'], column=block['col_offset'] + 1,
                                        metric=block['complexity'], message=f"Radon CC {block['complexity']} exceeds 8"))
            # --show-closures emits nested blocks both in parents and at top level.
            if item['id'] in findings and findings[item['id']] != item:
                raise ValueError('Ambiguous Radon identity')
            findings[item['id']] = item
        expected = {node.lineno for node in ast.walk(source.tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        if expected - seen:
            raise ValueError(f'Incomplete Radon function coverage: {file}, lines {sorted(expected - seen)}')
    return list(findings.values())
