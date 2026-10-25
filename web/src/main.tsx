import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";

import "@/styles/tailwind.css";
import "@/styles/reset_css.css";
import "@/styles/base_style.css";
import "@/styles/euchre.css";
import "@/styles/game-board.css";
import "@/styles/multiplayer.css";

import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
config.autoAddCss = false;

async function start() {
   if (document.fonts) {
      let timeout: number | undefined;
      try {
         await Promise.race([
            document.fonts.load('400 1em "appFont"'),
            new Promise<void>((resolve) => {
               timeout = window.setTimeout(resolve, 3000);
            }),
         ]);
      } catch {
         // Keep the app usable if the font download fails.
      } finally {
         window.clearTimeout(timeout);
      }
   }

   ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
         <HelmetProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL}>
               <App />
            </BrowserRouter>
         </HelmetProvider>
      </React.StrictMode>
   );
}

void start();
