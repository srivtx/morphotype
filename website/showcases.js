// Generated from the app: each animated showcase, its main material and settings,
// and its timeline rows exactly as the motion editor lays them out.
export const SHOWCASES = [
 {
  "id": "shape-shifter",
  "title": "Shape shifter",
  "no": 1,
  "material": "Font morph \u00b7 Liquid chrome",
  "settings": [
   {
    "label": "Morph blend",
    "value": 0,
    "min": 0,
    "max": 1,
    "to": 1
   },
   {
    "label": "Bevel",
    "value": 30,
    "min": 2,
    "max": 200
   },
   {
    "label": "Liquid",
    "value": 0.9,
    "min": 0,
    "max": 1.5
   }
  ],
  "palette": [
   "#1f0938",
   "#5a17d6",
   "#ff2e9a",
   "#ffd36b",
   "#ff7ad1"
  ],
  "bg": [
   "#2a0c4a",
   "#07030f"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "One outline swinging between Inter Black and Pacifico, in plasma chrome that keeps flowing.",
  "rows": [
   {
    "name": "Morph",
    "depth": 0,
    "tracks": [
     {
      "kind": "param",
      "label": "Morph \u00b7 Blend",
      "period": 4
     },
     {
      "kind": "flow",
      "label": "Liquid chrome \u00b7 Animate 0.35",
      "title": "Material"
     }
    ]
   },
   {
    "name": "To",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Blink",
      "period": 4
     }
    ]
   },
   {
    "name": "From",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Blink",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "glass-lens",
  "title": "Glass lens",
  "no": 2,
  "material": "Lens glass",
  "settings": [
   {
    "label": "Refraction",
    "value": 1.3,
    "min": 0,
    "max": 2
   },
   {
    "label": "Colour split",
    "value": 2,
    "min": 0,
    "max": 2
   },
   {
    "label": "Magnify",
    "value": 0.3,
    "min": -1,
    "max": 1
   }
  ],
  "palette": [
   "#efefef",
   "#39393b",
   "#161516",
   "#d3d3d4"
  ],
  "bg": [
   "#eeefef"
  ],
  "duration": 4,
  "layers": 2,
  "flavor": "A glass drop drifts across the word, bending and splitting it as it passes.",
  "rows": [
   {
    "name": "Drop",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Slide",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Shape \u00b7 Wobble",
      "period": 2
     }
    ]
   }
  ]
 },
 {
  "id": "crystal",
  "title": "Crystal",
  "no": 3,
  "material": "Lens glass \u00b7 facets",
  "settings": [
   {
    "label": "Refraction",
    "value": 1.6,
    "min": 0,
    "max": 2
   },
   {
    "label": "Rainbow light",
    "value": 1.6,
    "min": 0,
    "max": 2
   },
   {
    "label": "Rainbow shift",
    "value": 0.3,
    "min": -1,
    "max": 1,
    "to": -0.3
   }
  ],
  "palette": [
   "#000000",
   "#faf98e",
   "#610051",
   "#3c1439",
   "#ccf7b9"
  ],
  "bg": [
   "#000000"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "A faceted glass hexagon turns as it crosses the word, throwing rainbow light.",
  "rows": [
   {
    "name": "Crystal",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Slide",
      "period": 4
     }
    ]
   },
   {
    "name": "Gem",
    "depth": 1,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Rainbow shift",
      "period": 2
     }
    ]
   }
  ]
 },
 {
  "id": "frosted-404",
  "title": "Frosted 404",
  "no": 4,
  "material": "Frosted glass",
  "settings": [
   {
    "label": "Blur",
    "value": 30,
    "min": 0,
    "max": 120
   },
   {
    "label": "Tint amount",
    "value": 0.5,
    "min": 0,
    "max": 1
   },
   {
    "label": "Bend at edges",
    "value": 0.6,
    "min": 0,
    "max": 2,
    "to": 1.3
   }
  ],
  "palette": [
   "#141528",
   "#816e93",
   "#362b45",
   "#e9e5f0"
  ],
  "bg": [
   "#1d2140",
   "#0d0e15"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "A frosted folder floats over extruded numbers, its edges bending the light.",
  "rows": [
   {
    "name": "Close",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     }
    ]
   },
   {
    "name": "Glass folder",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Bend at edges",
      "period": 2
     }
    ]
   },
   {
    "name": "404",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Sway",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "thermal-wings",
  "title": "Thermal wings",
  "no": 5,
  "material": "Thermal",
  "settings": [
   {
    "label": "Heat spread",
    "value": 100,
    "min": 4,
    "max": 300,
    "to": 150
   },
   {
    "label": "Glow",
    "value": 200,
    "min": 0,
    "max": 400
   },
   {
    "label": "Shift colours",
    "value": 0,
    "min": -0.5,
    "max": 0.5,
    "to": 0.18
   }
  ],
  "palette": [
   "#e4e6ad",
   "#e9133d",
   "#f65225",
   "#cfae6d"
  ],
  "bg": [
   "#e8133c"
  ],
  "duration": 4,
  "layers": 7,
  "flavor": "A butterfly in heat-camera colours, its wings beating with a moving Stretch.",
  "rows": [
   {
    "name": "Title",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise",
      "start": 0.2,
      "end": 1
     }
    ]
   },
   {
    "name": "Butterfly",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Float",
      "period": 2
     },
     {
      "kind": "param",
      "label": "Shift colours",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Heat spread",
      "period": 2
     },
     {
      "kind": "param",
      "label": "Stretch \u00b7 Width",
      "period": 1
     }
    ]
   }
  ]
 },
 {
  "id": "holo-card",
  "title": "Holo card",
  "no": 6,
  "material": "Holographic",
  "settings": [
   {
    "label": "Foil coverage",
    "value": 1,
    "min": 0,
    "max": 1
   },
   {
    "label": "Rim width",
    "value": 12,
    "min": 0.5,
    "max": 80
   },
   {
    "label": "Pastel",
    "value": 0.55,
    "min": 0,
    "max": 1
   }
  ],
  "palette": [
   "#0c0b0e",
   "#71ee9b",
   "#d0e273",
   "#b655a6",
   "#d29f89"
  ],
  "bg": [
   "#0b0b0d"
  ],
  "duration": 4,
  "layers": 4,
  "flavor": "A holographic foil whose hue shifts all the way round as it sways.",
  "rows": [
   {
    "name": "Holo card",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Spin in",
      "start": 0.1,
      "end": 1.314284894496285
     },
     {
      "kind": "loop",
      "label": "Sway",
      "period": 4
     }
    ]
   },
   {
    "name": "Star",
    "depth": 1,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Hue shift",
      "period": 4
     }
    ]
   },
   {
    "name": "Card",
    "depth": 1,
    "tracks": [
     {
      "kind": "param",
      "label": "Hue shift",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "glow-glass",
  "title": "Glow glass",
  "no": 7,
  "material": "Glow glass",
  "settings": [
   {
    "label": "Rim intensity",
    "value": 1.5,
    "min": 0,
    "max": 4,
    "to": 2.6
   },
   {
    "label": "Rim width",
    "value": 14,
    "min": 1,
    "max": 120
   },
   {
    "label": "Bevel",
    "value": 40,
    "min": 2,
    "max": 200
   }
  ],
  "palette": [
   "#000000",
   "#c859d4",
   "#672574",
   "#45184d",
   "#270d2b"
  ],
  "bg": [
   "#000000"
  ],
  "duration": 4,
  "layers": 1,
  "flavor": "Glass letters rise in one by one as the glow drifts from blue to pink.",
  "rows": [
   {
    "name": "Word",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise \u00b7 3 letters in turn",
      "start": 0.1,
      "end": 1.08,
      "children": 3
     },
     {
      "kind": "param",
      "label": "Glow",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Rim intensity",
      "period": 2
     }
    ]
   }
  ]
 },
 {
  "id": "puffy",
  "title": "Puffy",
  "no": 8,
  "material": "Puffy",
  "settings": [
   {
    "label": "Puff",
    "value": 70,
    "min": 4,
    "max": 300
   },
   {
    "label": "Gloss",
    "value": 0.7,
    "min": 0,
    "max": 1.5
   },
   {
    "label": "Depth",
    "value": 0.9,
    "min": 0.1,
    "max": 3
   }
  ],
  "palette": [
   "#b49ef8",
   "#7a68ef",
   "#dfb6e9",
   "#f5def3"
  ],
  "bg": [
   "#b8a6ff",
   "#6f5cff"
  ],
  "duration": 4,
  "layers": 7,
  "flavor": "Inflated letters bounce in a wave while a cloud mascot floats and blinks.",
  "rows": [
   {
    "name": "Mascot",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Float",
      "period": 2
     }
    ]
   },
   {
    "name": "Eyes",
    "depth": 1,
    "tracks": [
     {
      "kind": "loop",
      "label": "Blink",
      "period": 2
     }
    ]
   },
   {
    "name": "Word",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Bounce",
      "period": 1
     }
    ]
   },
   {
    "name": "Sparkle",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Pulse",
      "period": 1
     }
    ]
   },
   {
    "name": "Sparkle",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Pulse",
      "period": 1
     }
    ]
   },
   {
    "name": "Sparkle",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Pulse",
      "period": 1
     }
    ]
   }
  ]
 },
 {
  "id": "aura",
  "title": "Aura",
  "no": 9,
  "material": "Aura gradient",
  "settings": [
   {
    "label": "Arrangement",
    "value": 3,
    "min": 0,
    "max": 100,
    "to": 4.5
   },
   {
    "label": "Edge glow",
    "value": 0.6,
    "min": 0,
    "max": 1
   },
   {
    "label": "Outer glow",
    "value": 0.25,
    "min": 0,
    "max": 1.5
   }
  ],
  "palette": [
   "#161616",
   "#1422d1",
   "#cbd268",
   "#a93f43",
   "#b6688d"
  ],
  "bg": [
   "#161616"
  ],
  "duration": 4,
  "layers": 5,
  "flavor": "Four mesh-gradient tiles grow in one by one, then their colour blobs drift.",
  "rows": [
   {
    "name": "Tiles",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow \u00b7 4 in turn",
      "start": 0.1,
      "end": 1.2695232629975233,
      "children": 4
     }
    ]
   },
   {
    "name": "Tile 4",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.45999999999999996,
      "end": 1.2695232629975233,
      "index": 3
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Arrangement",
      "period": 4
     }
    ]
   },
   {
    "name": "Tile 3",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.33999999999999997,
      "end": 1.1495232629975232,
      "index": 2
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Arrangement",
      "period": 4
     }
    ]
   },
   {
    "name": "Tile 2",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.22,
      "end": 1.0295232629975233,
      "index": 1
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Arrangement",
      "period": 4
     }
    ]
   },
   {
    "name": "Tile 1",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.1,
      "end": 0.9095232629975233,
      "index": 0
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Arrangement",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "pop-3d",
  "title": "Pop 3D",
  "no": 10,
  "material": "Retro 3D",
  "settings": [
   {
    "label": "Depth",
    "value": 46,
    "min": 0,
    "max": 120
   },
   {
    "label": "Direction",
    "value": 45,
    "min": 0,
    "max": 360
   },
   {
    "label": "Side shading",
    "value": 0.35,
    "min": 0,
    "max": 1
   }
  ],
  "palette": [
   "#b4f22e",
   "#fe4ea3",
   "#401f62",
   "#bf9362"
  ],
  "bg": [
   "#b4f22e"
  ],
  "duration": 3,
  "layers": 5,
  "flavor": "Extruded type whose depth direction turns a full circle every loop.",
  "rows": [
   {
    "name": "Pop",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.1,
      "end": 0.9095232629975233
     },
     {
      "kind": "loop",
      "label": "Pulse",
      "period": 0.75
     },
     {
      "kind": "param",
      "label": "Direction",
      "period": 3
     }
    ]
   },
   {
    "name": "Plus 4",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 3
     }
    ]
   },
   {
    "name": "Plus 3",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 3
     }
    ]
   },
   {
    "name": "Plus 2",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 3
     }
    ]
   },
   {
    "name": "Plus 1",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 3
     }
    ]
   }
  ]
 }
];
