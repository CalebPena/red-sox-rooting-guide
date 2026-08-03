import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/red-sox-rooting-guide/",
  plugins: [react()],
});
