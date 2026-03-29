# QLC+ Fixture Definitions

Fixture definitions for [QLC+](https://www.qlcplus.org/) (open-source lighting control software).

## Included Fixtures

| Fixture | Modes | Use For |
|---------|-------|---------|
| Hue Color Light | 8bit RGB (3ch), 8bit RGB+Dimmer (4ch), 16bit RGB (6ch) | Individual color-capable Hue lights |
| Hue White Light | Brightness (1ch) | Individual white-only / dimmable Hue lights |
| Hue Group (Brightness) | Brightness (1ch) | Rooms/zones with only white lights |
| Hue Scene Selector | Scene Selector (1ch) | Scene activation (0=none, 1-255=scene index) |

For groups (rooms/zones) that contain color-capable lights, use the **Hue Color Light** fixture in the appropriate mode — ArtNet Bridge detects the group's color capability automatically and assigns the correct channel layout.

## Installation

Copy the `.qxf` files from `qlc+/` to your QLC+ fixture directory:

- **Linux:** `~/.qlcplus/Fixtures/`
- **macOS:** `~/Library/Application Support/QLC+/Fixtures/`
- **Windows:** `%USERPROFILE%\QLC+\Fixtures\`

Then restart QLC+ and the fixtures will appear under the "ArtNet Bridge" manufacturer.

## Matching Fixtures to Your Config

Choose the QLC+ fixture and mode based on your `channelMode` setting in the ArtNet Bridge config:

| Config `channelMode` | QLC+ Fixture | QLC+ Mode |
|----------------------|-------------|-----------|
| `8bit` | Hue Color Light | 8bit RGB |
| `8bit-dimmable` | Hue Color Light | 8bit RGB + Dimmer |
| `16bit` | Hue Color Light | 16bit RGB |
| `brightness` | Hue White Light or Hue Group | Brightness |
| `scene-selector` | Hue Scene Selector | Scene Selector |

## Usage

1. In QLC+, add a fixture using "ArtNet Bridge" as the manufacturer
2. Select the fixture type matching your entity (color light, white light, group, or scene)
3. Select the mode matching your `channelMode` config
4. Set the DMX address to match the `dmxStart` in your ArtNet Bridge config
5. Configure QLC+ to output ArtNet to the machine running ArtNet Bridge
