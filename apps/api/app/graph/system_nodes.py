from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition
from .system_nodes_audio import audio_node_definitions
from .system_nodes_image import image_node_definitions
from .system_nodes_media import media_node_definitions
from .system_nodes_preset import preset_node_definitions
from .system_nodes_preview_debug import debug_node_definitions, preview_av_node_definitions, preview_image_node_definitions
from .system_nodes_prompt import prompt_node_definitions
from .system_nodes_utility import utility_node_definitions
from .system_nodes_video import video_node_definitions


def system_node_definitions() -> List[GraphNodeDefinition]:
    return [
        *prompt_node_definitions(),
        *media_node_definitions(),
        *audio_node_definitions(),
        *image_node_definitions(),
        *preview_image_node_definitions(),
        *video_node_definitions(),
        *preview_av_node_definitions(),
        *debug_node_definitions(),
        *utility_node_definitions(),
        *preset_node_definitions(),
    ]
