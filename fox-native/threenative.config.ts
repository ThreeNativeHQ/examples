import type { IThreeNativeConfig } from "@threenative/core";

export default {
  display: {
    // Follow the device instead of forcing a rotation. The default is "landscape", which locks
    // the activity and letterboxes the game when the phone is held upright; "sensor" lets the
    // window match how it is actually being held. "portrait" pins it the other way.
    orientation: "sensor",
  },
  renderer: { preferWebGPU: true },
} satisfies IThreeNativeConfig;
