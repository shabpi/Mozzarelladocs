#!/usr/bin/env python3
"""Render a clean Orion HVAC wireframe spin (no grid) and export GIF + favicon assets."""

from __future__ import annotations

import math
import os
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
FRAMES_DIR = PUBLIC / ".orion-spin-frames"

BG = (25, 25, 25, 255)
LINE = (56, 189, 248, 255)
GLOW = (14, 165, 233, 90)

FRAME_SIZE = 256
FAVICON_SIZE = 32
NUM_FRAMES = 48
GIF_SIZE = 128


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def box_edges(x0, y0, z0, x1, y1, z1) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    corners = [
        (x0, y0, z0),
        (x1, y0, z0),
        (x1, y0, z1),
        (x0, y0, z1),
        (x0, y1, z0),
        (x1, y1, z0),
        (x1, y1, z1),
        (x0, y1, z1),
    ]
    edge_idx = [
        (0, 1),
        (1, 2),
        (2, 3),
        (3, 0),
        (4, 5),
        (5, 6),
        (6, 7),
        (7, 4),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ]
    return [(corners[a], corners[b]) for a, b in edge_idx]


def circle_edges(cx, cy, cz, radius, segments=24, axis="y") -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    edges = []
    points = []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        if axis == "y":
            points.append((cx + radius * math.cos(t), cy, cz + radius * math.sin(t)))
        else:
            points.append((cx + radius * math.cos(t), cy + radius * math.sin(t), cz))
    for i in range(segments):
        edges.append((points[i], points[(i + 1) % segments]))
    return edges


def build_orion_edges() -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    """Wireframe HVAC unit inspired by Orion SVG proportions — no mesh grids."""
    edges: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []

    # Main cabinet (centered, y up)
    edges += box_edges(-1.05, 0.0, -0.65, 1.05, 0.95, 0.65)

    # Roof lip
    edges += box_edges(-1.12, 0.95, -0.72, 1.12, 1.02, 0.72)

    # Pallet base / legs
    edges += box_edges(-1.15, -0.08, -0.72, 1.15, 0.0, 0.72)
    for x in (-0.95, -0.35, 0.35, 0.95):
        for z in (-0.55, 0.55):
            edges.append(((x, -0.22, z), (x, -0.08, z)))

    # Top axial fan shroud (left on roof)
    edges += circle_edges(-0.45, 1.02, 0.0, 0.34, segments=28, axis="y")
    edges += circle_edges(-0.45, 1.02, 0.0, 0.22, segments=20, axis="y")

    # Roof vent (right)
    edges += box_edges(0.35, 0.95, -0.18, 0.78, 1.08, 0.18)
    edges += circle_edges(0.56, 1.08, 0.0, 0.12, segments=16, axis="y")

    # Front-left panel outlines (solid frames, no grid fill)
    edges += box_edges(-1.05, 0.12, 0.651, -0.15, 0.48, 0.651)
    edges += box_edges(-1.05, 0.52, 0.651, -0.15, 0.88, 0.651)

    # Right-side duct ports
    for yc in (0.28, 0.62):
        edges += circle_edges(1.051, yc, 0.22, 0.16, segments=20, axis="x")
        edges += circle_edges(1.051, yc, -0.22, 0.16, segments=20, axis="x")

    # Internal blower bay (visible cutaway on right-top)
    edges += box_edges(0.05, 0.55, -0.05, 0.82, 0.92, 0.42)
    edges += circle_edges(0.48, 0.74, 0.18, 0.14, segments=18, axis="y")

    # Compressor cylinders (bottom center, from first SVG view)
    for z in (-0.18, 0.18):
        edges += circle_edges(-0.05, 0.18, z, 0.12, segments=16, axis="y")
        edges.append(((-0.05, 0.06, z), (-0.05, 0.30, z)))

    # Pipe run between compressors
    edges.append(((-0.05, 0.24, -0.18), (-0.05, 0.24, 0.18)))

    # Control box
    edges += box_edges(-0.35, 0.42, -0.05, 0.05, 0.62, 0.18)

    return edges


def rotate_y(point: tuple[float, float, float], angle: float) -> tuple[float, float, float]:
    x, y, z = point
    c, s = math.cos(angle), math.sin(angle)
    return (x * c + z * s, y, -x * s + z * c)


def project(point: tuple[float, float, float], width: int, height: int) -> tuple[float, float]:
    x, y, z = point
    # Mild perspective
    depth = 2.8 + z * 0.35
    px = (x / depth) * width * 0.42 + width * 0.5
    py = height * 0.58 - (y / depth) * height * 0.42
    return px, py


def render_frame(edges, angle: float, size: int, line_width: int = 2, glow_width: int = 4) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    glow_draw = ImageDraw.Draw(glow)

    rotated = [
        (rotate_y(a, angle), rotate_y(b, angle))
        for a, b in edges
    ]

    def depth_key(segment):
        return (segment[0][2] + segment[1][2]) * 0.5

    rotated.sort(key=depth_key)

    for a, b in rotated:
        p1 = project(a, size, size)
        p2 = project(b, size, size)
        glow_draw.line([p1, p2], fill=GLOW, width=glow_width)
        draw.line([p1, p2], fill=LINE, width=line_width)

    glow = glow.filter(ImageFilter.GaussianBlur(2))
    return Image.alpha_composite(glow, img)


def save_gif(frames: list[Image.Image], path: Path, size: int) -> None:
    resized = [frame.resize((size, size), Image.Resampling.LANCZOS) for frame in frames]
    resized[0].save(
        path,
        save_all=True,
        append_images=resized[1:],
        duration=80,
        loop=0,
        optimize=True,
        disposal=2,
    )


def save_favicon_assets(frames: list[Image.Image], edges, public: Path) -> None:
    angle = 2 * math.pi * 0.125
    hero = render_frame(edges, angle, 128, line_width=3, glow_width=6)

    for size, name in ((16, "favicon-16x16.png"), (32, "favicon-32x32.png"), (180, "apple-touch-icon.png")):
        png = hero.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
        flat = Image.new("RGBA", (size, size), BG)
        flat.alpha_composite(png)
        flat.save(public / name, optimize=True)

    icon_16 = Image.open(public / "favicon-16x16.png").convert("RGBA")
    icon_32 = Image.open(public / "favicon-32x32.png").convert("RGBA")
    icon_32.save(public / "favicon.ico", format="ICO", sizes=[(32, 32), (16, 16)], append_images=[icon_16])


def extract_svg_silhouette(svg_path: Path, size: int) -> np.ndarray | None:
    """Optional: extract outer silhouette from SVG render (stroke-only, no grid)."""
    tmp = PUBLIC / ".favicon-build"
    tmp.mkdir(exist_ok=True)
    out = tmp / f"{svg_path.stem}.png"
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(svg_path),
                "-vf",
                f"scale={size}:{size}:force_original_aspect_ratio=decrease,"
                f"pad={size}:{size}:(ow-iw)/2:(oh-ih)/2:color=0x191919",
                "-frames:v",
                "1",
                str(out),
            ],
            check=True,
            capture_output=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    gray = np.array(Image.open(out).convert("L"))
    # Keep only bright line art; discard mid-tone grid fills
    mask = gray > 48
    return mask


def main() -> None:
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    edges = build_orion_edges()

    # Optional silhouette sanity check from SVGs (not drawn — keeps output grid-free)
    for name in ("orion.svg", "orion-2.svg"):
        path = PUBLIC / name
        if path.exists():
            extract_svg_silhouette(path, 128)

    frames: list[Image.Image] = []
    for i in range(NUM_FRAMES):
        angle = 2 * math.pi * i / NUM_FRAMES
        frame = render_frame(edges, angle, FRAME_SIZE)
        frame_path = FRAMES_DIR / f"frame_{i:03d}.png"
        frame.save(frame_path)
        frames.append(frame)

    save_gif(frames, PUBLIC / "orion-spin.gif", GIF_SIZE)
    save_gif(frames, PUBLIC / "orion-hologram.gif", 176)
    # Tab favicon uses lb-energy-logo.svg — do not overwrite favicon.ico here.


if __name__ == "__main__":
    main()
