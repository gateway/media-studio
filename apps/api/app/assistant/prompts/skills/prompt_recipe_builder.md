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
- Keep fields limited to user-facing creative content. Never put routing instructions, graph actions,
  serialized field labels, or product-planning prose into a recipe field.
- Set `request_save_confirmation` only when the user explicitly asks to save. The server owns the
  confirmation action; never invent or claim a save in prose.
- For graph requests, inspect the saved recipe and real `prompt.recipe` schema, then produce a typed
  graph proposal with valid connections. Do not resubmit a recipe draft merely because a recipe is used.
- In a saved-recipe graph, populate every required enabled variable. Also populate any template variable
  whose saved default is empty, including optional `image_analysis`; use a neutral user-facing value such
  as "No reference images provided" when the user supplied none.
- Connect the recipe's `text` output to the image model's prompt input, and connect every model image
  output to a preview or save node. A recipe-to-model graph is incomplete with a dangling model output.

Do not invent saved recipes, field values, or image analysis. Ask one question only when the desired
output shape is genuinely ambiguous. Do not claim the recipe was created, saved, added to a graph, or
tested unless the backend confirms it. Name the small field set when useful.
