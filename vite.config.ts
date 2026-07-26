import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig({
  plugins: [react(), sites()],
  resolve: {
    // O site vive dentro do repositório do launcher. Força todos os pacotes
    // React a usarem a mesma instância, mesmo quando o projeto pai tem outra versão.
    dedupe: ["react", "react-dom"],
  },
});
