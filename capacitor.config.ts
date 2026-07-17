import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.capyworkclock.timer",
  appName: "Capy Work Clock",
  webDir: "dist-mobile",
  backgroundColor: "#f6f0e3",
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "LIGHT",
      hidden: false,
    },
  },
};

export default config;
