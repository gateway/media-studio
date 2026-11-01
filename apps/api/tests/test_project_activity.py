"""Database-free checks. Run this file directly to bypass database-creating pytest fixtures."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import store_project_activity, store_reference_media, store_support
from app.store_project_activity_writes import content_project_ids, touch_projects


NOW = "2026-11-01T05:33:33.026204+00:00"


class ProjectActivityTests(unittest.TestCase):
    def setUp(self):
        # Any unexpected database access while exercising persistence must fail,
        # including readback. These tests use connection doubles, never SQLite.
        self.no_database = patch("sqlite3.connect", side_effect=AssertionError("database access forbidden"))
        self.no_database.start()
        self.addCleanup(self.no_database.stop)
        self.connection = MagicMock()

    def test_list_and_detail_expose_derived_activity_without_writing(self):
        row = {"project_id": "p", "name": "Sadi", "updated_at": "2026-07-01", "activity_at": NOW}
        self.connection.execute.return_value.fetchall.return_value = [row]
        self.connection.execute.return_value.fetchone.return_value = row
        with patch.object(store_project_activity, "get_connection") as context:
            context.return_value.__enter__.return_value = self.connection
            projects = store_project_activity.list_projects("all")
            detail = store_project_activity.get_project("p")
        self.assertEqual(projects, [detail])
        self.assertEqual(detail["updated_at"], NOW)
        self.assertNotIn("activity_at", detail)
        self.assertEqual(row["updated_at"], "2026-07-01")
        self.assertTrue(all(call.args[0].lstrip().startswith("SELECT") for call in self.connection.execute.call_args_list))

    def test_asset_move_touches_both_projects_in_the_upsert_transaction(self):
        self._check_upsert_activity("media_assets", "asset_id", [{"project_id": "old"}], [{"project_id": "new"}])

    def test_reference_edit_touches_all_attached_projects(self):
        projects = [{"project_id": "one"}, {"project_id": "two"}]
        self._check_upsert_activity("reference_media", "reference_id", projects, projects)

    def test_unassigned_asset_does_not_touch_projects(self):
        self._check_upsert_activity("media_assets", "asset_id", [{"project_id": None}], [{"project_id": None}])

    def _check_upsert_activity(self, table, key, before, after):
        first = MagicMock()
        first.fetchall.return_value = before
        last = MagicMock()
        last.fetchall.return_value = after
        self.connection.execute.side_effect = [first, MagicMock(), last, MagicMock(), MagicMock()]
        columns = {key, "created_at", "updated_at", "project_id"}
        with patch.object(store_support, "get_connection") as context, patch.object(
            store_support, "table_columns", return_value=columns
        ), patch.object(store_support, "get_table", return_value={key: "content"}), patch.object(
            store_support, "utcnow_iso", return_value=NOW
        ):
            context.return_value.__enter__.return_value = self.connection
            store_support.upsert_table(table, key, {key: "content", "project_id": "new"})
        calls = self.connection.execute.call_args_list
        self.assertTrue(calls[1].args[0].startswith("INSERT INTO " + table))
        touched = {call.args[1][1] for call in calls if call.args[0].startswith("UPDATE media_projects")}
        self.assertEqual(touched, {row["project_id"] for row in before + after if row["project_id"]})
        for call in calls[3:]:
            self.assertEqual(call.args[1][0], NOW)
            self.assertIn("julianday(updated_at) < julianday(?)", call.args[0])

    def test_metadata_upserts_keep_the_existing_timestamp_contract(self):
        with patch.object(store_support, "get_connection") as context, patch.object(
            store_support, "table_columns", return_value={"project_id", "name", "created_at", "updated_at"}
        ), patch.object(store_support, "get_table", return_value={"project_id": "p"}), patch.object(
            store_support, "utcnow_iso", return_value=NOW
        ):
            context.return_value.__enter__.return_value = self.connection
            store_support.upsert_table("media_projects", "project_id", {"project_id": "p", "name": "Renamed"})
        self.connection.execute.assert_called_once()
        self.assertIn(NOW, self.connection.execute.call_args.args[1])
        self.assertEqual(content_project_ids(self.connection, "media_projects", "p"), set())

    def test_reference_attach_and_detach_touch_only_when_membership_changes(self):
        for operation in [store_reference_media.attach_reference_to_project, store_reference_media.detach_reference_from_project]:
            for changed in [0, 1]:
                with self.subTest(operation=operation.__name__, changed=changed):
                    self.connection.reset_mock()
                    self.connection.execute.return_value.rowcount = changed
                    with patch.object(store_reference_media, "get_connection") as context, patch.object(
                        store_reference_media, "get_reference_media", return_value={"reference_id": "r"}
                    ), patch.object(store_reference_media, "utcnow_iso", return_value=NOW):
                        context.return_value.__enter__.return_value = self.connection
                        operation("p", "r")
                    self.assertEqual(self.connection.execute.call_count, 1 + changed)
                    if changed:
                        self.assertEqual(self.connection.execute.call_args.args[1], (NOW, "p", NOW))

    def test_touch_preserves_metadata_and_deduplicates_project_ids(self):
        touch_projects(self.connection, ["p", "p"], NOW)
        self.connection.execute.assert_called_once_with(
            "UPDATE media_projects SET updated_at = ? WHERE project_id = ? "
            "AND (updated_at IS NULL OR julianday(updated_at) < julianday(?))",
            (NOW, "p", NOW),
        )


if __name__ == "__main__":
    unittest.main()
