# Image Slot Planner

Use this section when a Media Preset may need runtime image inputs. Image slots are for user-provided visual content that controls a visible asset better than text.

Create image slots for:

- identity or likeness
- face
- full body
- pose
- product shape or material
- logo or brand mark
- vehicle shape
- garment, outfit, or wardrobe
- pet likeness
- room or interior
- location or background
- artwork reference
- texture reference
- pattern reference
- object or prop reference

Do not create image slots for vague inspiration. Do not create image slots just because a reference image was uploaded. Reference images attached to the assistant are style/source analysis unless the user explicitly chooses one as runtime content.

Preferred labels:

- `Portrait Reference`
- `Face Reference`
- `Full Body Reference`
- `Product Reference`
- `Logo Reference`
- `Vehicle Reference`
- `Outfit Reference`
- `Pet Reference`
- `Room Reference`
- `Location Reference`
- `Object Reference`
- `Source Image`
- `Artwork Reference`
- `Texture Reference`
- `Pattern Reference`

Every slot needs a role:

- identity and likeness source
- product shape and material source
- vehicle shape source
- room/background source
- logo source
- outfit source
- pet likeness source
- texture source
- pattern source
- object or prop source

If the user asks for two image inputs, such as face and body, preserve those roles exactly unless the selected mode cannot support them. If text or image input would both work for the same concept, choose the safer minimal setup or ask one short clarification.
