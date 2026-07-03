---
name: Banner image dimension reference
description: Correct banner image sizes per platform and placement type.
type: reference
originSessionId: 18ad51ef-d48a-4887-985e-92c697749242
---
## WS1 / WS2 (BIA)

| Placement | Version | Size | Format |
|---|---|---|---|
| Homepage | WS1 v3 | 1000×503px | JPG |
| Promo Page | WS1 v3 | 1000×565px | PNG |
| Homepage | WS1 v4 & WS2 | 1280×320px | JPG |
| Promo Page | WS1 v4 & WS2 | 1000×565px | PNG |

## QPRO / QPLY

| Placement | Size | Notes |
|---|---|---|
| Homepage | 1920×400px | Desktop; JPG |
| Promo Page (3.3 image) | 790×400px | Desktop; used in 3.3 Promotion Content `image` field |

Mobile (mup) counterparts are provided at narrower widths (960×400 for YE55, 790×400 for IBC22) but those are the banner carousel images, not the 3.3 content image.

## Key distinction

- `*-up-*` (1920×400px) images → 14.2 Banner `image_desktop` field only
- `*-mup-*` (790–960×400px depending on brand) → 14.2 Banner `image_mobile` field **AND** 3.3 Promotion Content `image` field

The mobile crop (`mup`) serves double duty: it is both the mobile banner and the promo-page thumbnail.
Script uploads `mobilePath` to `type=promotions` for the 3.3 image field.
