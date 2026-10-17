# CSS adoption review

Ticket 03 adopts Stylelint 17.16.0 with standard config 40.0.0 and PostCSS 8.5.26. No application CSS changes are included. The initial scan contains **1,127 findings across 17 CSS files**, retained individually in `css-baseline.json`; this is historical debt, not a claim that every warning is harmless.

| Rules | Findings | Review disposition |
| --- | ---: | --- |
| alpha-value-notation, color-function-alias-notation, color-function-notation | 786 | Existing `rgba` token/color notation; modernize separately without changing colors. |
| declaration-block-single-line-max-declarations | 153 | Existing compact declarations, primarily admin styles; no adoption reformat. |
| selector-class-pattern | 70 | Includes React Flow's externally owned `react-flow__*` selectors and existing BEM names; do not rename library selectors automatically. |
| no-descending-specificity | 42 | Existing cascade ordering debt. Examples include `assistant.css:1025` and node `media-display.css:41`; changes require affected-view verification, not automatic reordering. |
| media-feature-range-notation | 32 | Existing min/max width notation; no behavior change required for adoption. |
| at-rule-empty-line-before, declaration-empty-line-before, rule-empty-line-before, custom-property-empty-line-before | 24 | Existing whitespace conventions. |
| declaration-block-no-redundant-longhand-properties | 6 | Shorthand opportunities need cascade review. |
| property-no-vendor-prefix | 5 | Existing backdrop-filter/user-select compatibility declarations; retain until browser support is reviewed. |
| selector-not-notation | 3 | Existing equivalent selector notation. |
| value-keyword-case | 2 | Existing keyword casing. |
| font-family-name-quotes, color-hex-length | 2 | Existing quote/hex notation. |
| property-no-deprecated | 1 | `assistant.css:886` uses `clip: rect(0, 0, 0, 0)` in a visually hidden accessibility label. Replacement needs accessibility verification. |
| declaration-property-value-keyword-no-deprecated | 1 | Node `media-display.css:304` uses `word-break: break-word` in selectable preview text. Replacement needs wrapping verification. |

The config recognizes Tailwind v4 directives and string imports explicitly. Tailwind `@theme` token definitions and `@apply` have a real passing fixture. Standard CSS correctness rules remain enabled, including unknown properties/values, invalid colors and duplicate declarations. Inline disable comments do not suppress checks. Unknown rules, syntax failures, invalid configuration, missing output, missing files or missing dependencies fail closed. Baseline refresh is limited to the reviewed rule categories above; it cannot waive unknown-property or syntax failures.

The existing theme guard is run unchanged: source threshold 230 and CSS threshold 220, `globals.css` excluded as the token owner, and custom property definitions excluded in `admin.css`. This is an aggregate legacy theme policy; it does not guarantee every new raw color is rejected below the threshold. Stylelint checks both token files normally.

Finding identity uses file, rule/message, PostCSS declaration values, selector/at-rule ancestry, containing block content, neighboring blocks and the diagnostic position within its node. Blank lines and diagnostic reference line numbers do not invalidate historical findings. Renamed selectors, changed declaration values and replacements in another declaration context do. Ambiguous identities fail closed for explicit review. Context edits can require reviewing unchanged nearby debt; the gate does not guess a match. Ordinary lint never refreshes a baseline.

## Dependency review limits

Guardian's exact Stylelint/config checks returned only registry `prepare` script warnings; installation used `--ignore-scripts`. PostCSS was already required by Stylelint and is declared directly because the baseline uses its public parser API; Guardian's check had incomplete network coverage, so it is not a security clearance.

The installation's npm audit reported 14 advisories (1 moderate, 10 high, 3 critical), compared with 7 before this ticket. The added Stylelint advisory chain includes `braces <=3.0.3`, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), concerning stack exhaustion from deeply nested glob patterns. The gate supplies enumerated repository CSS paths, not user-submitted glob patterns, and has a timeout. Filenames are still interpreted by Stylelint's glob machinery, so this does not eliminate the dependency risk. npm's proposed Stylelint downgrade to 7.7.0 is not adopted. Existing application advisories and unrelated upgrades remain separate work.

Four existing CSSTools packages change with Stylelint's dependency resolution: css-calc 3.2.1 to 3.4.3, syntax-patches-for-csstree 1.1.4 to 1.1.15 (both required by Stylelint's newer minimums), and shared parser-algorithms/tokenizer 4.0.0 to 4.0.2. No other existing package versions change in this ticket.
