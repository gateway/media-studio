# Prompt Recipe Builder Skill

Use this skill when the user wants a reusable Prompt Recipe.

A Prompt Recipe is a reusable prompt-generation contract, not a Media Preset. Shape the recipe around the result the user wants it to write.

Plan a compact contract with:

- a clear title and purpose
- only the variables and custom fields that materially change the output
- required versus optional inputs with useful defaults only when the user supplied them
- image inputs when the recipe must inspect or describe an attached image
- an output format suited to the result, such as one prompt, a shot list, or separate prompts per panel

Typed draft state:

- Use `search_prompt_recipes` and `get_prompt_recipe` when the user references saved recipes.
- Use `validate_prompt_recipe_draft` for actionable validation feedback and
  `propose_prompt_recipe_draft` to persist the complete current draft.
- The draft must cover `system_prompt_template`, `input_variables_json`, `custom_fields_json`,
  `image_input_json`, `output_format`, and `output_contract_json`.
- Put every `{{template_token}}` in `input_variables_json`. A user-facing "field" that feeds the
  template is an input variable, not a duplicate custom field. Use `custom_fields_json` only for
  additional controls whose keys do not appear in `input_variables_json` or the template.
- Never use reserved variable keys as custom-field keys: `user_prompt`, `image_analysis`,
  `source_prompt`, `source_image_prompt`, `previous_output`, `shot_count`, `duration_seconds`,
  `aspect_ratio`, `output_format`, or `style_direction`.
- Image input mode must be exactly `none`, `direct_reference`, `analyze_then_inject`, or `both`.
  Use `analyze_then_inject` when the recipe should inspect an image and inject visible details through
  `{{image_analysis}}`; configure a non-empty image analysis prompt and the matching enabled variable.
- On revisions, start from `active_recipe_draft` and update structured variables, fields, image behavior,
  template, or output contract directly. Never recover draft state from assistant prose.
- When revising a saved recipe in a fresh session, pass the exact `recipe_id` returned by
  `get_prompt_recipe` as `existing_recipe_id` to validation and proposal tools. Never infer editable
  identity from the label or key alone.
- When the user derives a Prompt Recipe from a saved Media Preset, inspect that preset with
  `get_preset` and preserve its exact `model_key` and `default_options_json` under
  `rules_json.media_generation` as `source_preset_id`, `model_key`, and `default_options_json`.
  Do not infer this contract from notes, labels, or an older recipe that lacks typed provenance.
- Keep fields limited to user-facing creative content. Never put routing instructions, graph actions,
  serialized field labels, or product-planning prose into a recipe field.
- Set `request_save_confirmation` only when the user explicitly asks to save. The server owns the
  confirmation action; never invent or claim a save in prose.
- For graph requests, inspect the saved recipe and real `prompt.recipe` schema, then produce a typed
  graph proposal with valid connections. Do not resubmit a recipe draft merely because a recipe is used.
- When a saved recipe has `rules_json.media_generation`, use its exact model and generation defaults
  in the graph. When the user plainly asks to change one of those settings, list only that recipe id
  and the exact changed model or option value in `derived_recipe_defaults_overrides`. Never include an
  inherited setting the user did not ask to change.
- When the current workflow already has a paid generation path, reuse a compatible recipe/model/preview
  path instead of appending another paid path. If the requested recipe cannot safely reuse that path,
  ask whether to replace the graph or start a fresh workflow. Add another paid branch only when the user
  clearly asks to compose multiple outputs; in that case set `additional_paid_path_intent` to
  `explicitly_requested` in the graph proposal.
- In a saved-recipe graph, populate every required enabled variable. Also populate any template variable
  whose saved default is empty, including optional `image_analysis`; use a neutral user-facing value such
  as "No reference images provided" when the user supplied none.
- When the saved recipe's image-input mode is `none`, do not spend a graph-building step analyzing attached
  references or imply that the graph consumes them. Keep them attached as source evidence for the optional
  post-run output comparison instead.
- Connect the recipe's `text` output to the image model's prompt input, and connect every model image
  output to a preview or save node. A recipe-to-model graph is incomplete with a dangling model output.
- After a confirmed recipe graph produces an image, call `read_run_evidence` for that exact run before
  `analyze_recipe_output`. Compare the generated output with only the attached source references requested
  by the user. Keep visible observations separate from the suggested prompt delta, and never apply that
  delta, change the graph or recipe, or request another paid run without the user's explicit confirmation.

Do not invent saved recipes, field values, or image analysis. Ask one question only when the desired
output shape is genuinely ambiguous. Do not claim the recipe was created, saved, added to a graph, or
tested unless the backend confirms it. Name the small field set when useful.
