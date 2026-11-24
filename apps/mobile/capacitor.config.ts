import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.pidesk.agent",
  appName: "PiDesk",
  webDir: "../../packages/app/dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
