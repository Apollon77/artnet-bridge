# QLC+ Fixture Definitions

Fixture definitions for [QLC+](https://www.qlcplus.org/) (open-source lighting control software).

## Included Fixtures

| Fixture | Modes | Description |
|---------|-------|-------------|
| Hue Light (RGB) | 8bit RGB (3ch), 8bit RGB+Dimmer (4ch), 16bit RGB (6ch) | Individual Hue color light |
| Hue Group (Brightness) | Brightness (1ch) | Room/zone brightness control |
| Hue Scene Selector | Scene Selector (1ch) | Scene activation (0=none, 1-255=scene index) |

## Installation

Copy the `.qxf` files from `qlc+/` to your QLC+ fixture directory:

- **Linux:** `~/.qlcplus/Fixtures/`
- **macOS:** `~/Library/Application Support/QLC+/Fixtures/`
- **Windows:** `%USERPROFILE%\QLC+\Fixtures\`

Then restart QLC+ and the fixtures will appear under the "ArtNet Bridge" manufacturer.

## Usage

1. In QLC+, add a fixture using "ArtNet Bridge" as the manufacturer
2. Select the appropriate fixture type and mode matching your ArtNet Bridge channel configuration
3. Set the DMX address to match the `dmxStart` in your ArtNet Bridge config
4. Configure QLC+ to output ArtNet to the machine running ArtNet Bridge
