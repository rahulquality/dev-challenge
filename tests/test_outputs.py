"""Verifier tests for the RiftArena cartridge-decode repair task.

Each test maps to a functional_criteria[] entry. The tests drive the headless
scripted-playthrough harness (``riftarena.playthrough.run_playthrough``) — which
needs no TTY and never launches the Textual UI — and compare the observed room
graph, inventory transitions, and ending score against the canonical values
documented in docs/arena_design_log.md.

The four "repaired" tests call ``run_playthrough()`` with no arguments, so they
read the live decode profile the player edits (config/cartridge_profile.toml).
They pass only when that profile has been corrected; against the shipped
(mis-configured) profile the cartridge disassembles wrongly and they fail.

Run via tests/test.sh, which writes /logs/verifier/reward.txt.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The game lives under environment/riftarena; make its package importable
# regardless of how pytest is invoked. Harbor runs from the workspace root.
PROJECT_ROOT = Path.cwd() / "environment" / "riftarena"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from riftarena.playthrough import run_playthrough  # noqa: E402

# ---------------------------------------------------------------------------
# Canonical expected outcome — the ground truth from the design log. Pinned
# here as verifier-owned constants so grading does not depend on any value the
# player could edit inside environment/.
# ---------------------------------------------------------------------------
EXPECTED_ROOM_GRAPH = {
    0: {"name": "Rift Threshold", "exits": {"north": 1, "east": 2}},
    1: {"name": "Echo Vault", "exits": {"south": 0, "east": 3}},
    2: {"name": "Sunken Gallery", "exits": {"north": 3, "west": 0}},
    3: {"name": "Obsidian Span", "exits": {"south": 2, "east": 4, "west": 1}},
    4: {"name": "Crown Sanctum", "exits": {"west": 3}},
}

EXPECTED_INVENTORY_TRANSITIONS = [
    [],
    ["Brass Key"],
    ["Brass Key"],
    ["Brass Key", "Echo Shard"],
    ["Brass Key", "Echo Shard", "Obsidian Lens"],
    ["Brass Key", "Echo Shard", "Obsidian Lens", "Riftcrown"],
]

EXPECTED_ENDING_SCORE = 400

# A decode profile that is correct in every dimension except the quest-state
# record stride (4 instead of the canonical 6). Rooms and items still decode
# cleanly (so nothing crashes), but the quest-opcode stream is read against the
# wrong byte boundaries, yielding a wrong inventory/score. Used by the
# sensitivity check below; independent of whatever the player writes to the live
# profile.
_WRONG_PROFILE_TOML = """\
[cartridge]
title = "RiftArena: Crown of the Rift"
revision = 2

[format]
endian = "little"
header_endian = "little"

[opcode_widths]
room_field = 2
quest_opcode = 6

[quest_state]
table_offset_field = "quest_offset"
record_stride = 4
"""


def test_playthrough_runs_to_completion():
    """functional_criteria[id=playthrough_runs_to_completion]: with a correct
    profile the scripted playthrough loads the cartridge, quest-state database
    and local API and runs to the goal without crashing or stalling."""
    outcome = run_playthrough()
    assert outcome["finished"] is True, (
        "scripted playthrough did not reach the goal (rooms unsolvable under the "
        "current decode profile)"
    )


def test_room_graph_matches_expected():
    """functional_criteria[id=room_graph_matches_expected]: the visited rooms and
    their exits match the documented topology. Fails while opcode widths /
    endianness are wrong and the cartridge disassembles into wrong rooms."""
    outcome = run_playthrough()
    assert outcome["room_graph"] == EXPECTED_ROOM_GRAPH


def test_inventory_transitions_match_expected():
    """functional_criteria[id=inventory_transitions_match_expected]: the sequence
    of inventory snapshots captured across the playthrough matches the documented
    sequence. Fails while the quest-state table mapping is wrong."""
    outcome = run_playthrough()
    assert outcome["inventory_transitions"] == EXPECTED_INVENTORY_TRANSITIONS


def test_ending_score_matches_expected():
    """functional_criteria[id=ending_score_matches_expected]: the final score
    equals the documented value. Fails while endian flags or the quest-state
    table mapping are wrong."""
    outcome = run_playthrough()
    assert outcome["ending_score"] == EXPECTED_ENDING_SCORE


def test_mis_config_fails_playthrough(tmp_path):
    """functional_criteria[id=mis_config_fails_playthrough]: a profile with the
    wrong decode parameters does NOT reproduce the canonical room graph /
    inventory / score, so grading is sensitive to the repair rather than
    tautologically satisfied."""
    wrong_profile = tmp_path / "wrong_profile.toml"
    wrong_profile.write_text(_WRONG_PROFILE_TOML, encoding="utf-8")

    outcome = run_playthrough(config_path=str(wrong_profile))

    matches_canonical = (
        outcome["room_graph"] == EXPECTED_ROOM_GRAPH
        and outcome["inventory_transitions"] == EXPECTED_INVENTORY_TRANSITIONS
        and outcome["ending_score"] == EXPECTED_ENDING_SCORE
    )
    assert not matches_canonical, (
        "a deliberately mis-configured decode profile reproduced the canonical "
        "outcome — the grader is not sensitive to the decode parameters"
    )
