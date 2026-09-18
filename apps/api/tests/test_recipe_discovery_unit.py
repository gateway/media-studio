"""Recipe discovery contract checks without databases or providers."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

class RecipeDiscoveryTests(unittest.TestCase):
    def test_search_exposes_constraints_and_requires_full_inspection(self):
        with patch("sqlite3.connect", side_effect=AssertionError("Database forbidden")), patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
            from app.assistant import recipe_kernel
            recipe = {"recipe_id": "saved-nine", "key": "board", "label": "A cinematic board", "category": "image", "output_format": "single_prompt", "output_contract_json": {"grid": "3x3"}, "custom_fields_json": [{"key": "aspect_ratio", "label": "Aspect", "type": "select", "default_value": "16:9", "options": [{"value": "16:9", "label": "Wide"}]}]}
            with patch.object(recipe_kernel.store, "list_prompt_recipes", return_value=[recipe]):
                result = recipe_kernel.search_prompt_recipes(recipe_kernel.SearchPromptRecipesArguments(query="board"), None)
            item = result["items"][0]
            self.assertEqual(item["output_contract_json"], {"grid": "3x3"})
            self.assertEqual(item["custom_fields"][0]["default_value"], "16:9")
            self.assertTrue(item["requires_full_inspection"])

    def test_binding_requires_current_full_recipe_inspection(self):
        from app.assistant import recipe_kernel
        from types import SimpleNamespace
        recipe = {"recipe_id": "saved-nine", "key": "board", "label": "Board", "category": "image", "system_prompt_template": "Make nine panels", "output_contract_json": {"grid": "3x3"}}
        session = {"assistant_session_id": "recipe-proof", "summary_json": {}}
        context = SimpleNamespace(session_id="recipe-proof", session=session)
        def remember(record):
            session.update(record)
            return dict(session)
        with patch.object(recipe_kernel.store_assistant, "get_assistant_session", return_value=session), patch.object(recipe_kernel.store_assistant, "create_or_update_assistant_session", side_effect=remember), patch.object(recipe_kernel.store, "get_prompt_recipe", return_value=recipe), patch.object(recipe_kernel.registry, "get_definition", return_value=SimpleNamespace(ports={}, fields=[])):
            with self.assertRaises(recipe_kernel.RecipeKernelError):
                recipe_kernel.require_recipe_inspection(recipe, context)
            recipe_kernel.get_prompt_recipe(recipe_kernel.GetPromptRecipeArguments(recipe_id_or_key="saved-nine"), context)
            recipe_kernel.require_recipe_inspection(recipe, context)
            recipe["system_prompt_template"] = "Make twelve panels"
            with self.assertRaises(recipe_kernel.RecipeKernelError):
                recipe_kernel.require_recipe_inspection(recipe, context)

    def test_undeliverable_recipe_does_not_count_as_inspected(self):
        from app.assistant import recipe_kernel
        from types import SimpleNamespace
        recipe = {"recipe_id": "large", "key": "large", "label": "Large recipe", "category": "image", "system_prompt_template": "A" * 40000}
        session = {"assistant_session_id": "recipe-proof", "summary_json": {}}
        context = SimpleNamespace(session_id="recipe-proof", session=session)
        def remember(record):
            session.update(record)
            return dict(session)
        with patch.object(recipe_kernel.store_assistant, "get_assistant_session", return_value=session), patch.object(recipe_kernel.store_assistant, "create_or_update_assistant_session", side_effect=remember), patch.object(recipe_kernel.store, "get_prompt_recipe", return_value=recipe), patch.object(recipe_kernel.registry, "get_definition", return_value=SimpleNamespace(ports={}, fields=[])):
            with self.assertRaises(recipe_kernel.RecipeKernelError):
                recipe_kernel.get_prompt_recipe(recipe_kernel.GetPromptRecipeArguments(recipe_id_or_key="large"), context)
            with self.assertRaises(recipe_kernel.RecipeKernelError):
                recipe_kernel.require_recipe_inspection(recipe, context)

    def test_saved_recipe_inspection_filters_ports_by_selected_recipe(self):
        from app.assistant import recipe_kernel
        from app.graph.schemas import GraphNodePort
        from types import SimpleNamespace
        recipe = {"recipe_id": "saved-board", "key": "board", "label": "Board", "category": "image", "system_prompt_template": "Make six panels"}
        definition = SimpleNamespace(fields=[], ports={"inputs": [
            GraphNodePort(id="user_prompt", label="Brief", type="text"),
            GraphNodePort(id="character_ref", label="Host", type="image", visible_if={"field": "recipe_id", "in": ["saved-board"]}),
            GraphNodePort(id="additional_refs", label="Other", type="image", visible_if={"field": "recipe_id", "in": ["another-recipe"]}),
        ], "outputs": [GraphNodePort(id="text", label="Prompt", type="text")]})
        with patch.object(recipe_kernel.store, "get_prompt_recipe", return_value=recipe), patch.object(recipe_kernel.registry, "get_definition", return_value=definition):
            result = recipe_kernel.get_prompt_recipe(recipe_kernel.GetPromptRecipeArguments(recipe_id_or_key="board"), None)
        self.assertEqual(result["graph_node"]["fields"], {"recipe_id": "saved-board"})
        self.assertEqual([p["id"] for p in result["graph_node"]["ports"]["inputs"]], ["user_prompt", "character_ref"])
        self.assertEqual([p["id"] for p in result["graph_node"]["ports"]["outputs"]], ["text"])

if __name__ == "__main__":
    unittest.main()
