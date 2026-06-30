from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from .limits import is_image_attachment
from .skills import ASSISTANT_SKILLS, AssistantSkill
from .skill_kernel import manifest_for_legacy_skill_id


WORKFLOW_TERMS = ("workflow", "work graph", "graph", "node", "nodes", "wire", "connect", "output", "preview", "save image")
RECIPE_TERMS = (
    "recipe",
    "prompt recipe",
    "storyboard generator",
    "character generator",
    "prompt generator",
    "generator prompt",
    "storyboard",
)
PRESET_TERMS = ("media preset", "preset", "style preset", "studio preset")
REPAIR_TERMS = ("fix", "repair", "debug", "failed", "error", "broken")
MEDIA_TERMS = ("image", "photo", "reference", "attached", "uploaded", "reddit", "look at it", "analyze")
STORY_PROJECT_TERMS = (
    "story",
    "story bible",
    "character sheet",
    "character sheets",
    "storyboard segment",
    "next storyboard",
    "shot storyboard",
    "shot sequence",
    "scene storyboard",
    "storyboard",
    "seed dance",
    "seedance",
)
STORY_RECIPE_TERMS = ("storyboard generator", "character generator", "prompt generator", "prompt recipe", "recipe")
GRAPH_CREATION_NEGATION_PATTERNS = (
    "do not build a graph",
    "don't build a graph",
    "dont build a graph",
    "do not create a graph",
    "don't create a graph",
    "dont create a graph",
    "do not make a graph",
    "don't make a graph",
    "dont make a graph",
    "do not build a workflow",
    "don't build a workflow",
    "dont build a workflow",
    "do not create a workflow",
    "don't create a workflow",
    "dont create a workflow",
    "do not make a workflow",
    "don't make a workflow",
    "dont make a workflow",
    "chat text only",
    "text only",
)
GRAPH_CREATION_TERMS = (
    "build a graph",
    "create a graph",
    "make a graph",
    "add graph",
    "add the graph",
    "add it to graph",
    "add it to the graph",
    "build a workflow",
    "create a workflow",
    "make a workflow",
    "graph plan",
    "workflow plan",
)


@dataclass(frozen=True)
class AssistantIntentRoute:
    skill: AssistantSkill
    confidence: float
    needs_clarification: bool
    questions: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)
    media_intent: bool = False
    mixed_intent: bool = False

    def to_dict(self) -> Dict[str, Any]:
        manifest = manifest_for_legacy_skill_id(self.skill.skill_id)
        return {
            "skill_id": self.skill.skill_id,
            "runtime_skill_id": manifest.skill_id,
            "capability": self.skill.capability,
            "confidence": self.confidence,
            "needs_clarification": self.needs_clarification,
            "questions": self.questions,
            "suggestions": self.suggestions,
            "media_intent": self.media_intent,
            "mixed_intent": self.mixed_intent,
        }


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _normalized_text(message: str) -> str:
    return " ".join(str(message or "").lower().split())


def is_graph_creation_negated(message: str) -> bool:
    text = _normalized_text(message)
    return _contains_any(text, GRAPH_CREATION_NEGATION_PATTERNS)


def is_explicit_graph_creation_request(message: str) -> bool:
    text = _normalized_text(message)
    return _contains_any(text, GRAPH_CREATION_TERMS) and not is_graph_creation_negated(text)


def _is_explicit_story_graph_creation_request(text: str) -> bool:
    if is_explicit_graph_creation_request(text):
        return True
    if is_graph_creation_negated(text):
        return False
    if not _contains_any(text, STORY_PROJECT_TERMS):
        return False
    has_create_verb = any(term in text for term in ("create", "build", "make", "add", "wire", "connect"))
    has_graph_surface = any(
        term in text
        for term in (
            "graph",
            "workflow",
            "node",
            "nodes",
            "loader",
            "load image",
            "character sheet ref",
            "shared character sheet",
            "sections",
        )
    )
    return has_create_verb and has_graph_surface


def is_story_project_request(message: str) -> bool:
    text = _normalized_text(message)
    if not text:
        return False
    if any(term in text for term in STORY_RECIPE_TERMS):
        if _is_explicit_story_graph_creation_request(text):
            return True
        return False
    if _contains_any(text, STORY_PROJECT_TERMS):
        return True
    if "prompt" in text and any(term in text for term in ("shot", "scene", "storyboard", "segment")) and any(
        term in text for term in ("show", "full", "all", "rewrite", "revise", "change")
    ):
        return True
    if "shot" in text and any(term in text for term in ("duration", "camera", "action", "motion", "continuity")):
        return True
    if "segment" in text and any(term in text for term in ("continue", "previous", "storyboard", "seed dance", "seedance")):
        return True
    return False


def _image_count(attachments: List[Dict[str, Any]]) -> int:
    return len([attachment for attachment in attachments if is_image_attachment(attachment)])


def _limit_questions(questions: List[str]) -> List[str]:
    deduped: List[str] = []
    for question in questions:
        if question not in deduped:
            deduped.append(question)
    return deduped[:3]


def _workflow_questions(*, recipe_like: bool, preset_like: bool, media_intent: bool, image_count: int, output_clear: bool) -> List[str]:
    questions: List[str] = []
    if recipe_like:
        questions.append("Should I draft a new Prompt Recipe for this workflow, or use an existing recipe from your library?")
    if preset_like:
        questions.append("Should this workflow use a new Media Preset, or should I wire an existing preset node?")
    if media_intent and image_count == 0:
        questions.append("Should the image reference come from a new upload, an existing gallery image, or a Load Image node you will choose later?")
    if not output_clear:
        questions.append("Should the workflow finish with preview only, save image, or both?")
    if not questions:
        questions.append("Do you want me to build this as a graph plan now, or ask a few more creative setup questions first?")
    return _limit_questions(questions)


def _recipe_questions(*, media_intent: bool, image_count: int, message: str) -> List[str]:
    questions = [
        "Which fields should the recipe expose to users: creative brief, style, character details, shot count, or something else?",
        "Should the recipe output one polished prompt, multiple prompts, or structured JSON?",
    ]
    if media_intent or image_count:
        questions.insert(1, "Should image analysis be optional, required, or only used when a reference image is attached?")
    if "storyboard" in message:
        questions.insert(1, "Should the storyboard recipe create one combined 3x3 prompt or separate prompts for each panel?")
    if "character" in message:
        questions.insert(1, "Should character identity fields be separate from outfit, pose, expression, and environment?")
    return _limit_questions(questions)


def _preset_questions(*, media_intent: bool, image_count: int) -> List[str]:
    if media_intent or image_count:
        questions = [
            "Should the uploaded image references be inspiration only, image inputs, or both?",
            "Do you want separate face/body/product image inputs, or one general reference image input?",
            "Should I keep the editable form fields minimal, or add separate fields for outfit, background, and style notes?",
        ]
    else:
        questions = [
            "Does this preset need image inputs, or is it prompt-only?",
            "Which one or two form fields should users edit before running it?",
        ]
    return _limit_questions(questions)


def route_assistant_intent(message: str, attachments: List[Dict[str, Any]] | None = None) -> AssistantIntentRoute:
    attachments = attachments or []
    text = _normalized_text(message)
    image_count = _image_count(attachments)
    media_intent = image_count > 0 or _contains_any(text, MEDIA_TERMS)
    workflow_like = _contains_any(text, WORKFLOW_TERMS)
    recipe_like = _contains_any(text, RECIPE_TERMS)
    preset_like = _contains_any(text, PRESET_TERMS)
    repair_like = _contains_any(text, REPAIR_TERMS)
    output_clear = any(term in text for term in ("preview", "save", "output image", "image output", "video output", "audio output"))
    story_project_like = is_story_project_request(text)

    if repair_like:
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["repair_debug"],
            confidence=0.85,
            needs_clarification=False,
            suggestions=["I can inspect the failed run, explain what broke, and propose a repair plan before changing the graph."],
            media_intent=media_intent,
        )

    if story_project_like and not is_explicit_graph_creation_request(text):
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["answer_question"],
            confidence=0.88,
            needs_clarification=False,
            suggestions=[
                "I can keep this as story-planning chat first, then build the graph only when you explicitly ask for one."
            ],
            media_intent=media_intent,
        )

    # Explicit graph language wins over recipe/preset terms because the user is asking for a composed workflow.
    if workflow_like:
        questions = _workflow_questions(
            recipe_like=recipe_like,
            preset_like=preset_like,
            media_intent=media_intent,
            image_count=image_count,
            output_clear=output_clear,
        )
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["create_workflow"],
            confidence=0.82 if recipe_like or preset_like else 0.9,
            needs_clarification=bool(questions),
            questions=questions,
            suggestions=[
                "I can turn this into a graph with input nodes, the right generator node, preview/save outputs, and a note explaining the workflow.",
                "If a recipe or preset is needed, I will draft it first instead of silently saving it.",
            ],
            media_intent=media_intent,
            mixed_intent=recipe_like or preset_like,
        )

    if recipe_like:
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["create_prompt_recipe"],
            confidence=0.86,
            needs_clarification=True,
            questions=_recipe_questions(media_intent=media_intent, image_count=image_count, message=text),
            suggestions=[
                "I can draft this as a Prompt Recipe with variables, optional image analysis, and an output contract you can review before saving."
            ],
            media_intent=media_intent,
        )

    if preset_like:
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["create_media_preset"],
            confidence=0.86,
            needs_clarification=True,
            questions=_preset_questions(media_intent=media_intent, image_count=image_count),
            suggestions=[
                "I can draft this as a Media Preset with model compatibility, form fields, media slots, and thumbnail guidance."
            ],
            media_intent=media_intent,
        )

    if any(term in text for term in ("build", "create", "make", "generate")):
        return AssistantIntentRoute(
            skill=ASSISTANT_SKILLS["create_workflow"],
            confidence=0.62,
            needs_clarification=True,
            questions=["Should this become a graph workflow, a Prompt Recipe, or a Media Preset?"],
            suggestions=["Tell me the artifact you want and I will make a draft before changing anything."],
            media_intent=media_intent,
        )

    return AssistantIntentRoute(
        skill=ASSISTANT_SKILLS["answer_question"],
        confidence=0.7,
        needs_clarification=False,
        suggestions=["I can explain the graph, help choose models, or turn your idea into a workflow, Prompt Recipe, or Media Preset."],
        media_intent=media_intent,
    )


def intent_guidance_text(route: AssistantIntentRoute, provider_error: str = "") -> str:
    artifact = {
        "create_workflow": "workflow",
        "create_prompt_recipe": "Prompt Recipe",
        "create_media_preset": "Media Preset",
        "repair_debug": "repair plan",
        "answer_question": "answer",
    }.get(route.skill.skill_id, "plan")
    opener = f"I can help shape that into a {artifact}."
    if route.media_intent:
        opener += " I will treat the attached media as reference context, not as something to save or run without confirmation."
    if route.suggestions:
        opener += f" {route.suggestions[0]}"
    if route.questions:
        question_text = " ".join(f"{index + 1}. {question}" for index, question in enumerate(route.questions))
        opener += f" I need: {question_text}"
    if provider_error:
        opener += " I used the built-in Media Studio workflow rules for this turn, so we can keep moving without exposing system details."
    return opener
