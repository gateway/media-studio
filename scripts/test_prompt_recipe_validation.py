"""Pure recipe characterization: real schemas/validation, in-memory store only.

Run directly with Python; do not collect through the database-creating API conftest.
"""
from contextlib import contextmanager
import importlib
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1] / "apps/api/app"
PACKAGE = "_recipe_validation_test_app"


@contextmanager
def recipe_validation(source=None):
    package = ModuleType(PACKAGE)
    package.__path__ = [str(ROOT)]
    graph = ModuleType(f"{PACKAGE}.graph")
    graph.__path__ = [str(ROOT / "graph")]
    store = ModuleType(f"{PACKAGE}.store")
    store.get_prompt_recipe_by_key = Mock(return_value=None)
    store.get_prompt_recipe = Mock(return_value=None)
    store.get_preset = Mock(return_value=None)
    store.create_or_update_prompt_recipe = Mock(side_effect=lambda record: record)
    with patch.dict(sys.modules, {
        PACKAGE: package, f"{PACKAGE}.graph": graph, f"{PACKAGE}.store": store,
    }):
        spec = importlib.util.spec_from_file_location(
            f"{PACKAGE}.service_prompt_recipe_validation",
            source or ROOT / "service_prompt_recipe_validation.py",
        )
        validation = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validation)
        schemas = importlib.import_module(f"{PACKAGE}.schemas")
        yield validation, schemas, store


def payload(schemas, **changes):
    return schemas.PromptRecipeUpsertRequest(**{
        "key": "example", "label": " Example ", "category": "utility",
        "system_prompt_template": " {{user_prompt}} ", **changes,
    })


def custom_field(**changes):
    return {"key": "tone", "label": " Tone ", "type": "select", **changes}


class RecipeValidationTests(unittest.TestCase):
    def test_options_normalize_without_reordering_or_mutating_payload(self):
        with recipe_validation() as (validation, schemas, _):
            request = payload(schemas, custom_fields=[custom_field(options=[" warm ", "", "  ", "cool"])])
            before = request.model_dump()
            result = validation.validate_prompt_recipe_payload(request)
            self.assertEqual(result["custom_fields_json"][0], {
                "key": "tone", "label": "Tone", "type": "select", "placeholder": None,
                "default_value": "", "required": False, "help_text": None,
                "options": ["warm", "cool"], "input_kind": "none", "reference_role": "none",
            })
            self.assertEqual(request.model_dump(), before)

    def test_empty_select_options_keep_exact_error(self):
        with recipe_validation() as (validation, schemas, _):
            for options in ([], [""], ["  ", ""]):
                with self.subTest(options=options), self.assertRaises(validation.ServiceError) as error:
                    validation.validate_prompt_recipe_payload(payload(schemas, custom_fields=[custom_field(options=options)]))
                self.assertEqual(str(error.exception), "Select custom field tone must define options.")

    def test_duplicate_options_are_checked_after_trimming_and_remain_case_sensitive(self):
        with recipe_validation() as (validation, schemas, _):
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(payload(schemas, custom_fields=[custom_field(options=[" warm", "warm "])]))
            self.assertEqual(str(error.exception), "Select custom field tone has duplicate options.")
            result = validation.validate_prompt_recipe_payload(payload(schemas, custom_fields=[custom_field(options=["Warm", "warm"])]))
            self.assertEqual(result["custom_fields_json"][0]["options"], ["Warm", "warm"])

    def test_non_select_options_still_trim_and_keep_duplicates(self):
        with recipe_validation() as (validation, schemas, _):
            for kind in ("text", "textarea", "number", "boolean"):
                with self.subTest(kind=kind):
                    result = validation.validate_prompt_recipe_payload(payload(schemas, custom_fields=[custom_field(type=kind, options=[" a ", "", "a"])]))
                    self.assertEqual(result["custom_fields_json"][0]["options"], ["a", "a"])

    def test_custom_field_error_order(self):
        cases = [
            ([custom_field(key="user_prompt")], "Custom field key conflicts with reserved variable: user_prompt"),
            ([custom_field(key="tone")], "Select custom field tone must define options."),
            ([custom_field(type="invalid")], "Custom field type is invalid for tone."),
            ([custom_field(options=["x"]), custom_field()], "Custom field keys must be unique."),
        ]
        with recipe_validation() as (validation, schemas, _):
            for fields, message in cases:
                with self.subTest(message=message), self.assertRaises(validation.ServiceError) as error:
                    validation.validate_prompt_recipe_payload(payload(schemas, custom_fields=fields, rules={"allow_external_variables": False}, system_prompt_template="{{external}}"))
                self.assertEqual(str(error.exception), message)

    def test_custom_variable_conflict_precedes_option_errors(self):
        with recipe_validation() as (validation, schemas, _):
            request = payload(schemas, input_variables=[{"key": "tone", "label": "Tone"}], custom_fields=[custom_field()])
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(request)
            self.assertEqual(str(error.exception), "Custom field key conflicts with an input variable: tone")

    def test_duplicate_recipe_key_and_existing_recipe_update(self):
        with recipe_validation() as (validation, schemas, store):
            store.get_prompt_recipe_by_key.return_value = {"recipe_id": "existing"}
            request = payload(schemas, system_prompt_template="{{Bad-token}}")
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(request)
            self.assertEqual(str(error.exception), "A prompt recipe with this key already exists.")
            updated = validation.upsert_prompt_recipe(payload(schemas), "existing")
            self.assertEqual(updated["recipe_id"], "existing")
            store.create_or_update_prompt_recipe.assert_called_once_with(updated)

    def test_malformed_tokens_are_sorted_and_deduplicated(self):
        with recipe_validation() as (validation, schemas, _):
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(payload(schemas, system_prompt_template="{{z-bad}} {{Bad}} {{z-bad}}"))
            self.assertEqual(str(error.exception), "Invalid prompt recipe variable token: Bad, z-bad")

    def test_categories_statuses_and_early_errors(self):
        with recipe_validation() as (validation, schemas, _):
            for category in ("image", "video", "analysis", "utility"):
                for status in ("active", "inactive", "archived"):
                    result = validation.validate_prompt_recipe_payload(payload(schemas, category=category, status=status))
                    self.assertEqual((result["category"], result["status"]), (category, status))
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(payload(schemas, status="invalid", custom_fields=[custom_field()]))
            self.assertEqual(str(error.exception), "Prompt recipe status is invalid.")
            with self.assertRaises(validation.ServiceError) as error:
                validation.validate_prompt_recipe_payload(payload(schemas, category="invalid", status="invalid"))
            self.assertEqual(str(error.exception), "Prompt recipe category is invalid.")

    def test_reserved_custom_and_external_variables_preserve_warning_order(self):
        with recipe_validation() as (validation, schemas, _):
            result = validation.validate_prompt_recipe_payload(payload(schemas,
                system_prompt_template="{{shot_count}} {{external}} {{disabled}} {{tone}}",
                input_variables=[{"key": "disabled", "label": "Disabled", "enabled": False}, {"key": "unused", "label": "Unused"}],
                custom_fields=[custom_field(options=["warm"]), custom_field(key="other", options=["x"])],
            ))
            self.assertEqual([item["key"] for item in result["input_variables_json"]], ["disabled", "unused", "shot_count"])
            self.assertEqual(result["validation_warnings_json"], [
                "Enabled variables are not used in the template: unused.",
                "Template uses variables that are disabled in the recipe: disabled.",
                "Template uses external variables that future graph nodes must provide: external.",
                "Custom fields are configured but not used in the template: other.",
            ])

    def test_draft_aliases_and_serialized_values(self):
        with recipe_validation() as (validation, schemas, _):
            raw = {"label": " Draft Recipe ", "template": "{{user_prompt}}", "input_variables": ["User Prompt"],
                   "custom_fields": [custom_field(options=[" warm "])], "notes": [" One ", "", "Two"],
                   "rules": ["Keep Style"], "default_options": {"temperature": 0}, "output_contract": {"count": 2}}
            normalized = validation._normalize_prompt_recipe_draft_payload(raw, schemas.PromptRecipeDraftRequest(idea="draft"))
            result = validation.validate_prompt_recipe_payload(schemas.PromptRecipeUpsertRequest(**normalized))
            self.assertEqual((result["key"], result["status"], result["notes"]), ("draft_recipe", "inactive", "One\nTwo"))
            self.assertEqual(result["rules_json"], {"keep_style": True, "allow_external_variables": True})
            self.assertEqual(result["default_options_json"], {"temperature": 0})
            self.assertEqual(result["output_contract_json"], {"count": 2})
            self.assertEqual(result["custom_fields_json"][0]["options"], ["warm"])


if __name__ == "__main__":
    unittest.main()
