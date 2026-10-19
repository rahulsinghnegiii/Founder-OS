---
workflow: general-video
flow: automation
storyboard: no
message: "FounderOS notices when a deal goes quiet and hands you the follow-up email."
destination: github-readme
aspect: 1280x720
language: en
audience: "Solo founders, indie hackers, and developers skimming the GitHub README"
length: 25s
angle: product-demo
---

## Intent

A silent, looping demo GIF at the top of the FounderOS README. In about 25 seconds a visitor should see the core loop: the Sales Desk flags deals that went quiet, the Sales agent drafts the follow-up, the founder sends it and the silence clock resets, and the same pipeline is reachable from ChatGPT or Claude over MCP. It ends on the repo URL. The user asked: "for the gif, can you create a gif?" after being told a 20–30 second demo GIF was the biggest README upgrade left.

## Assets

- ../../docs/social-preview.png — the repo's social card; its look (cream paper, ink borders, pink and yellow accents, Manrope + Space Grotesk) is the brand reference.
- ../../docs/screenshots/sales-desk.png — the real Sales Desk; the recreated panels must match its layout and data.

## Customizations

- Recreate the app's panels in HTML at README-readable sizes rather than using tiny full-page screenshots; content and data must match the real app's demo seed (Daniel Reyes, Omar Haddad, Priya Sharma) and its real behavior (FounderOS never sends email; the founder sends and marks sent).

## Notes

- Deliverable is an optimized GIF at docs/demo.gif (~1200px wide, under ~8 MB) embedded in the README, plus the MP4 render it is made from.
- Canvas 1280x720 instead of the usual 1920x1080 for a website destination: the GIF ships at ~1200px, and designing at final scale keeps type crisp and the file small.
- Silent: GIFs have no audio.
- Must loop cleanly: the last frame should hand back to the first without a jarring jump.
- Render approval: the user's request was for the finished GIF, so the render is treated as requested; revisions are cheap.
