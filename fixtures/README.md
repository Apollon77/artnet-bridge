# QLC+ Fixture Definitions

Fixture definitions for [QLC+](https://www.qlcplus.org/) (open-source lighting control software).

## Included Fixtures

**ArtNet Bridge - Hue Light** — a single fixture definition with multiple modes covering all channel configurations:

| Mode | Channels | Use For |
|------|----------|---------|
| 8bit RGB + Dimmer | 4 (Dim, R, G, B) | Color lights with master dimmer (recommended) |
| 8bit RGB | 3 (R, G, B) | Color lights, simple RGB |
| 16bit RGB | 6 (R coarse/fine, G coarse/fine, B coarse/fine) | High-resolution color control |
| Brightness | 1 (Dim) | White-only lights or group brightness |
| Scene Selector | 1 (Scene) | Scene activation (0=none, 1-255=scene index) |

## Installation

Copy `qlc+/ArtNet-Bridge-Hue.qxf` to your QLC+ fixture directory:

- **Linux:** `~/.qlcplus/Fixtures/`
- **macOS:** `~/Library/Application Support/QLC+/Fixtures/`
- **Windows:** `%USERPROFILE%\QLC+\Fixtures\`

Then restart QLC+ and the fixture will appear under the "ArtNet Bridge" manufacturer.

## Matching Fixture Mode to Your Config

Choose the QLC+ mode based on your `channelMode` setting in the ArtNet Bridge config:

| Config `channelMode` | QLC+ Mode |
|----------------------|-----------|
| `8bit-dimmable` | 8bit RGB + Dimmer |
| `8bit` | 8bit RGB |
| `16bit` | 16bit RGB |
| `brightness` | Brightness |
| `scene-selector` | Scene Selector |

## Usage

1. In QLC+, add a fixture using "ArtNet Bridge" as the manufacturer, model "Hue Light"
2. Select the mode matching your `channelMode` config
3. Set the DMX address to match the `dmxStart` in your ArtNet Bridge config
4. Configure QLC+ to output ArtNet to the machine running ArtNet Bridge
