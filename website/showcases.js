// Generated from the app: each animated showcase, its main material and settings,
// and its timeline rows exactly as the motion editor lays them out.
export const SHOWCASES = [
 {
  "id": "neon-sign",
  "title": "Neon sign",
  "no": 1,
  "material": "Neon tube",
  "settings": [
   {
    "label": "Tube width",
    "value": 6,
    "min": 0.5,
    "max": 40
   },
   {
    "label": "Glow radius",
    "value": 30,
    "min": 1,
    "max": 200
   },
   {
    "label": "Intensity",
    "value": 1.1,
    "min": 0,
    "max": 3
   }
  ],
  "palette": [
   "#2b2b2e",
   "#2fd8ff",
   "#e9fbff",
   "#ff3df2",
   "#fff3ff"
  ],
  "bg": [
   "#2b2b2e"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "Three neon tubes. The glow breathes, the frame pulses, and the tube flickers.",
  "rows": [
   {
    "name": "Late night",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Fade in",
      "start": 1.1,
      "end": 1.2517856118120356
     },
     {
      "kind": "loop",
      "label": "Blink",
      "period": 2
     }
    ]
   },
   {
    "name": "Open",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Fade in",
      "start": 0.6,
      "end": 0.7517856118120356
     },
     {
      "kind": "param",
      "label": "Glow radius",
      "period": 1
     },
     {
      "kind": "flow",
      "label": "Neon tube \u00b7 Flicker 0.2",
      "title": "Material"
     }
    ]
   },
   {
    "name": "Frame",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Fade in",
      "start": 0.1,
      "end": 0.5
     },
     {
      "kind": "param",
      "label": "Intensity",
      "period": 2
     }
    ]
   }
  ]
 },
 {
  "id": "sticker-pack",
  "title": "Sticker pack",
  "no": 2,
  "material": "Sticker",
  "settings": [
   {
    "label": "Outline width",
    "value": 10,
    "min": 0,
    "max": 60
   },
   {
    "label": "Border width",
    "value": 12,
    "min": 0,
    "max": 60
   },
   {
    "label": "Shine",
    "value": 0.25,
    "min": 0,
    "max": 1
   }
  ],
  "palette": [
   "#ffd6e8",
   "#ffb21e",
   "#14121a",
   "#2f7bff",
   "#ff4f7a"
  ],
  "bg": [
   "#ffd6e8"
  ],
  "duration": 4,
  "layers": 7,
  "flavor": "Five die-cut stickers that pop in one after another, then sway together.",
  "rows": [
   {
    "name": "Title",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise",
      "start": 1.1,
      "end": 1.7746027191646028
     }
    ]
   },
   {
    "name": "Stickers",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow \u00b7 5 in turn",
      "start": 0.2,
      "end": 1.502062991081063,
      "children": 5
     },
     {
      "kind": "loop",
      "label": "Sway",
      "period": 2
     }
    ]
   },
   {
    "name": "flower sticker",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.76,
      "end": 1.502062991081063,
      "index": 4
     }
    ]
   },
   {
    "name": "star sticker",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.6200000000000001,
      "end": 1.3620629910810633,
      "index": 3
     }
    ]
   },
   {
    "name": "heart sticker",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.48000000000000004,
      "end": 1.2220629910810632,
      "index": 2
     }
    ]
   },
   {
    "name": "bolt sticker",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.34,
      "end": 1.082062991081063,
      "index": 1
     }
    ]
   },
   {
    "name": "moon sticker",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.2,
      "end": 0.9420629910810632,
      "index": 0
     }
    ]
   }
  ]
 },
 {
  "id": "liquid-chrome",
  "title": "Liquid chrome",
  "no": 3,
  "material": "Liquid chrome",
  "settings": [
   {
    "label": "Bevel",
    "value": 46,
    "min": 2,
    "max": 200
   },
   {
    "label": "Softness",
    "value": 10,
    "min": 0,
    "max": 80
   },
   {
    "label": "Depth",
    "value": 1.3,
    "min": 0.1,
    "max": 4
   }
  ],
  "palette": [
   "#1424ff",
   "#ffffff",
   "#0a0030",
   "#5b2bd6"
  ],
  "bg": [
   "#1424ff",
   "#000028",
   "#4fb4ff",
   "#c7e4ff"
  ],
  "duration": 4,
  "layers": 5,
  "flavor": "Chrome that keeps flowing on its own, with three dots in orbit.",
  "rows": [
   {
    "name": "Y2K",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise",
      "start": 0.5,
      "end": 1.2
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 2
     },
     {
      "kind": "flow",
      "label": "Liquid chrome \u00b7 Animate 0.5",
      "title": "Material"
     }
    ]
   },
   {
    "name": "Sparkle",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.1,
      "end": 1.044443806830444
     },
     {
      "kind": "loop",
      "label": "Spin",
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
    "name": "Orbiter 3",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Orbit",
      "period": 4
     }
    ]
   },
   {
    "name": "Orbiter 2",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Orbit",
      "period": 4
     }
    ]
   },
   {
    "name": "Orbiter 1",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Orbit",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "keyboard",
  "title": "Keyboard",
  "no": 4,
  "material": "Keycap",
  "settings": [
   {
    "label": "Wall width",
    "value": 30,
    "min": 2,
    "max": 160
   },
   {
    "label": "Tilt",
    "value": 0.3,
    "min": -1,
    "max": 1
   },
   {
    "label": "Tilt sideways",
    "value": -0.15,
    "min": -1,
    "max": 1
   }
  ],
  "palette": [
   "#e9edf3",
   "#f2f3f5",
   "#9ec4ea",
   "#2a2a30",
   "#ffb21e"
  ],
  "bg": [
   "#e9edf3"
  ],
  "duration": 4,
  "layers": 17,
  "flavor": "Five keycaps drop in turn and spell it out, then pulse.",
  "rows": [
   {
    "name": "Caption",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Fade in",
      "start": 1.2,
      "end": 1.7999999999999998
     }
    ]
   },
   {
    "name": "Keys",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop \u00b7 5 in turn",
      "start": 0.2,
      "end": 1.1941664275614166,
      "children": 5
     },
     {
      "kind": "loop",
      "label": "Pulse",
      "period": 2
     }
    ]
   },
   {
    "name": "Key O",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.8400000000000001,
      "end": 1.1941664275614166,
      "index": 4
     }
    ]
   },
   {
    "name": "Key L",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.6799999999999999,
      "end": 1.0341664275614164,
      "index": 3
     }
    ]
   },
   {
    "name": "Key L",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.52,
      "end": 0.8741664275614165,
      "index": 2
     }
    ]
   },
   {
    "name": "Key E",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.36,
      "end": 0.7141664275614165,
      "index": 1
     }
    ]
   },
   {
    "name": "Key H",
    "depth": 1,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.2,
      "end": 0.5541664275614164,
      "index": 0
     }
    ]
   }
  ]
 },
 {
  "id": "melting",
  "title": "Melting",
  "no": 5,
  "material": "Melt modifier",
  "settings": [
   {
    "label": "Drip length",
    "value": 0.05,
    "to": 0.55,
    "min": 0,
    "max": 1.5
   },
   {
    "label": "Drip spacing",
    "value": 0.3,
    "min": 0.05,
    "max": 2
   }
  ],
  "palette": [
   "#ff7a2f",
   "#ff9a3d",
   "#fff3e0",
   "#5a1a00"
  ],
  "bg": [
   "#ff7a2f"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "A Melt modifier whose drips stretch and settle again every four seconds.",
  "rows": [
   {
    "name": "Caption",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise",
      "start": 0.3,
      "end": 0.8999999999999999
     }
    ]
   },
   {
    "name": "Melt",
    "depth": 0,
    "tracks": [
     {
      "kind": "param",
      "label": "Melt \u00b7 Drip length",
      "period": 4
     }
    ]
   },
   {
    "name": "Sun",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "arcade",
  "title": "Arcade",
  "no": 6,
  "material": "Pixelate modifier",
  "settings": [
   {
    "label": "Pixel size (ghost)",
    "value": 0.07,
    "min": 0.01,
    "max": 0.3
   },
   {
    "label": "Pixel size (dots)",
    "value": 0.25,
    "min": 0.01,
    "max": 0.3
   },
   {
    "label": "Gap",
    "value": 0,
    "min": 0,
    "max": 0.8
   }
  ],
  "palette": [
   "#000000",
   "#2fd8ff",
   "#ff4fa3",
   "#ffffff",
   "#ff3d3d"
  ],
  "bg": [
   "#000000"
  ],
  "duration": 4,
  "layers": 21,
  "flavor": "A pixelate modifier, a floating ghost, and dots on a one-way lane.",
  "rows": [
   {
    "name": "Press start",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Blink",
      "period": 1
     }
    ]
   },
   {
    "name": "Lane",
    "depth": 0,
    "tracks": []
   },
   {
    "name": "Dots",
    "depth": 1,
    "tracks": [
     {
      "kind": "loop",
      "label": "Slide",
      "period": 0.5
     }
    ]
   },
   {
    "name": "Heart",
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
    "name": "Ghost",
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
    "name": "Level",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Drop",
      "start": 0.2,
      "end": 0.8746027191646029
     }
    ]
   }
  ]
 },
 {
  "id": "plush-weather",
  "title": "Plush weather",
  "no": 7,
  "material": "Plush",
  "settings": [
   {
    "label": "Fuzz",
    "value": 8,
    "min": 0,
    "max": 40
   },
   {
    "label": "Fur fineness",
    "value": 1,
    "min": 0.2,
    "max": 4
   },
   {
    "label": "Light",
    "value": 0.75,
    "min": 0,
    "max": 1
   }
  ],
  "palette": [
   "#7ccfff",
   "#ffc21a",
   "#e0641c",
   "#ffe24a",
   "#d18a00"
  ],
  "bg": [
   "#7ccfff",
   "#2b8bff"
  ],
  "duration": 4,
  "layers": 4,
  "flavor": "Fuzzy plush material on a cloud, a sun and a blinking bolt.",
  "rows": [
   {
    "name": "Forecast",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Rise",
      "start": 0.9,
      "end": 1.5
     }
    ]
   },
   {
    "name": "Cloud",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "From left",
      "start": 0.3,
      "end": 1.2
     },
     {
      "kind": "loop",
      "label": "Float",
      "period": 4
     }
    ]
   },
   {
    "name": "Bolt",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Blink",
      "period": 1.3333333333333333
     }
    ]
   },
   {
    "name": "Sun",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "Grow",
      "start": 0.1,
      "end": 1.1793643506633644
     },
     {
      "kind": "loop",
      "label": "Spin",
      "period": 4
     }
    ]
   }
  ]
 },
 {
  "id": "holo-card",
  "title": "Holo card",
  "no": 8,
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
   "#0b0b0d",
   "#101018",
   "#ffffff"
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
  "id": "pop-3d",
  "title": "Pop 3D",
  "no": 9,
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
   "#14121a",
   "#ff4fa3",
   "#5b2bd6"
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
 },
 {
  "id": "print-club",
  "title": "Print club",
  "no": 10,
  "material": "Risograph",
  "settings": [
   {
    "label": "Misregister X",
    "value": 7,
    "min": -40,
    "max": 40
   },
   {
    "label": "Misregister Y",
    "value": 5,
    "min": -40,
    "max": 40
   },
   {
    "label": "Second ink",
    "value": 0.85,
    "min": 0,
    "max": 1
   }
  ],
  "palette": [
   "#f2ede4",
   "#ff4fb1",
   "#2b6bff"
  ],
  "bg": [
   "#f2ede4"
  ],
  "duration": 4,
  "layers": 3,
  "flavor": "Two riso inks whose registration jitters, and words from both sides.",
  "rows": [
   {
    "name": "Club",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "From right",
      "start": 0.35,
      "end": 0.9571424472481425
     }
    ]
   },
   {
    "name": "Print",
    "depth": 0,
    "tracks": [
     {
      "kind": "enter",
      "label": "From left",
      "start": 0.2,
      "end": 0.8071424472481425
     }
    ]
   },
   {
    "name": "Flower",
    "depth": 0,
    "tracks": [
     {
      "kind": "loop",
      "label": "Spin",
      "period": 4
     },
     {
      "kind": "param",
      "label": "Misregister X",
      "period": 0.5
     }
    ]
   }
  ]
 }
];
