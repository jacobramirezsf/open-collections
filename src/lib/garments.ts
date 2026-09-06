// Garment blanks usable as a canvas background, so a piece can be seen on the thing it would
// actually be printed on.
export interface GarmentColor {
  slug: string
  name: string
  file: string
}

export interface GarmentProduct {
  id: string
  label: string
  colors: GarmentColor[]
}

export const GARMENTS: GarmentProduct[] = [
  {
    id: 'hoodie-heavy',
    label: 'Heavyweight hoodie',
    colors: [
      { slug: 'offblack', name: "Laa 14oz Offblack", file: 'hoodie-heavy/offblack.webp' },
      { slug: 'cream', name: "Laa 14oz Cream", file: 'hoodie-heavy/cream.webp' },
      { slug: 'navy', name: "Laa 14oz Navy", file: 'hoodie-heavy/navy.webp' },
      { slug: 'army', name: "Laa 14oz Army", file: 'hoodie-heavy/army.webp' },
      { slug: 'chocolate', name: "Laa 14oz Chocolate", file: 'hoodie-heavy/chocolate.webp' },
      { slug: 'brightorange', name: "Laa 14oz Brightorange", file: 'hoodie-heavy/brightorange.webp' },
      { slug: 'sage', name: "Laa 14oz Sage", file: 'hoodie-heavy/sage.webp' },
      { slug: 'rosequartz', name: "Laa 14oz Rosequartz", file: 'hoodie-heavy/rosequartz.webp' },
      { slug: 'cobaltblue', name: "Laa 14oz Cobaltblue", file: 'hoodie-heavy/cobaltblue.webp' },
      { slug: 'darkred', name: "Laa 14oz Darkred", file: 'hoodie-heavy/darkred.webp' },
      { slug: 'mushroom', name: "Laa 14oz Mushroom", file: 'hoodie-heavy/mushroom.webp' },
      { slug: 'vintageblack', name: "Laa 14oz Vintageblack", file: 'hoodie-heavy/vintageblack.webp' },
    ],
  },
  {
    id: 'hoodie-mid',
    label: 'Midweight hoodie',
    colors: [
      { slug: 'black', name: "Ind 8p5 Black", file: 'hoodie-mid/black.webp' },
      { slug: 'ivory', name: "Ind 8p5 Ivory", file: 'hoodie-mid/ivory.webp' },
      { slug: 'navy', name: "Ind 8p5 Navy", file: 'hoodie-mid/navy.webp' },
      { slug: 'olive', name: "Ind 8p5 Olive", file: 'hoodie-mid/olive.webp' },
      { slug: 'cherry', name: "Ind 8p5 Cherry", file: 'hoodie-mid/cherry.webp' },
      { slug: 'azure', name: "Ind 8p5 Azure", file: 'hoodie-mid/azure.webp' },
      { slug: 'sand', name: "Ind 8p5 Sand", file: 'hoodie-mid/sand.webp' },
      { slug: 'seafoam', name: "Ind 8p5 Seafoam", file: 'hoodie-mid/seafoam.webp' },
      { slug: 'greyheather', name: "Ind 8p5 Greyheather", file: 'hoodie-mid/greyheather.webp' },
      { slug: 'violet', name: "Ind 8p5 Violet", file: 'hoodie-mid/violet.webp' },
    ],
  },
  {
    id: 'hoodie-premium',
    label: 'Premium hoodie',
    colors: [
      { slug: 'black', name: "Ind420hoodie Black", file: 'hoodie-premium/black.webp' },
      { slug: 'ivory', name: "Ind420hoodie Ivory", file: 'hoodie-premium/ivory.webp' },
      { slug: 'classicnavy', name: "Ind420hoodie Classic Navy", file: 'hoodie-premium/classicnavy.webp' },
      { slug: 'olive', name: "Ind420hoodie Olive", file: 'hoodie-premium/olive.webp' },
      { slug: 'brown', name: "Ind420hoodie Brown", file: 'hoodie-premium/brown.webp' },
      { slug: 'greyheather', name: "Ind420hoodie Grey Heather", file: 'hoodie-premium/greyheather.webp' },
      { slug: 'pigmentblack', name: "Ind420hoodie Pigmentblack", file: 'hoodie-premium/pigmentblack.webp' },
    ],
  },
  {
    id: 'zip-hoodie',
    label: 'Zip hoodie',
    colors: [
      { slug: 'black', name: "Ind420zip Black", file: 'zip-hoodie/black.webp' },
      { slug: 'heathergrey', name: "Ind420zip Heather Grey", file: 'zip-hoodie/heathergrey.webp' },
      { slug: 'pigmentblack', name: "Ind420zip Pigment Black", file: 'zip-hoodie/pigmentblack.webp' },
    ],
  },
  {
    id: 'crewneck',
    label: 'Crewneck',
    colors: [
      { slug: 'black', name: "Black", file: 'crewneck/black.webp' },
      { slug: 'offwhite', name: "Offwhite", file: 'crewneck/offwhite.webp' },
      { slug: 'navy', name: "Navy", file: 'crewneck/navy.webp' },
      { slug: 'army', name: "Army", file: 'crewneck/army.webp' },
      { slug: 'chocolate', name: "Chocolate", file: 'crewneck/chocolate.webp' },
      { slug: 'tomato', name: "Tomato", file: 'crewneck/tomato.webp' },
      { slug: 'sage', name: "Sage", file: 'crewneck/sage.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'crewneck/cobaltblue.webp' },
      { slug: 'lightgrey', name: "Light Grey", file: 'crewneck/lightgrey.webp' },
      { slug: 'creme', name: "Creme", file: 'crewneck/creme.webp' },
      { slug: 'purple', name: "Purple", file: 'crewneck/purple.webp' },
      { slug: 'gold', name: "Gold", file: 'crewneck/gold.webp' },
    ],
  },
  {
    id: 'crewneck-wash',
    label: 'Mineral wash crewneck',
    colors: [
      { slug: 'carbon', name: "Carbon", file: 'crewneck-wash/carbon.webp' },
      { slug: 'arctic', name: "Arctic", file: 'crewneck-wash/arctic.webp' },
      { slug: 'indigo', name: "Indigo", file: 'crewneck-wash/indigo.webp' },
      { slug: 'cocoa', name: "Cocoa", file: 'crewneck-wash/cocoa.webp' },
      { slug: 'matcha', name: "Matcha", file: 'crewneck-wash/matcha.webp' },
      { slug: 'limestone', name: "Limestone", file: 'crewneck-wash/limestone.webp' },
    ],
  },
  {
    id: 'beanie',
    label: 'Beanie',
    colors: [
      { slug: 'black', name: "Black", file: 'beanie/black.webp' },
      { slug: 'natural', name: "Natural", file: 'beanie/natural.webp' },
      { slug: 'navy', name: "Navy", file: 'beanie/navy.webp' },
      { slug: 'olive', name: "Olive", file: 'beanie/olive.webp' },
      { slug: 'burgundy', name: "Burgundy", file: 'beanie/burgundy.webp' },
      { slug: 'rust', name: "Rust", file: 'beanie/rust.webp' },
      { slug: 'forestgreen', name: "Forestgreen", file: 'beanie/forestgreen.webp' },
      { slug: 'greyheather', name: "Grey Heather", file: 'beanie/greyheather.webp' },
      { slug: 'cobaltblue', name: "Cobaltblue", file: 'beanie/cobaltblue.webp' },
      { slug: 'neonyellow', name: "Neonyellow", file: 'beanie/neonyellow.webp' },
    ],
  },
  {
    id: 'shorts',
    label: 'Thermal shorts',
    colors: [
      { slug: 'black', name: "Black", file: 'shorts/black.webp' },
      { slug: 'creme', name: "Creme", file: 'shorts/creme.webp' },
      { slug: 'blue', name: "Blue", file: 'shorts/blue.webp' },
      { slug: 'white', name: "White", file: 'shorts/white.webp' },
    ],
  },
  {
    id: 'tote',
    label: 'Tote bag',
    colors: [
      { slug: 'clearblue', name: "Clear Blue", file: 'tote/clearblue.webp' },
    ],
  },
  {
    id: 'gym-bag',
    label: 'Gym bag',
    colors: [
      { slug: 'naturalcanvas', name: "Natural Canvas", file: 'gym-bag/naturalcanvas.webp' },
      { slug: 'lightpink', name: "Light Pink", file: 'gym-bag/lightpink.webp' },
    ],
  },
]

export const garmentUrl = (file: string) => `/garments/${file}`

// A garment background is addressed as `garment:<product>/<colour>`
export function findGarment(ref: string): { product: GarmentProduct; color: GarmentColor } | null {
  const [pid, cslug] = ref.split('/')
  const product = GARMENTS.find((g) => g.id === pid)
  const color = product?.colors.find((c) => c.slug === cslug)
  return product && color ? { product, color } : null
}

