import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthProvider } from "@/context/AuthContext";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { SoundProvider } from "@/context/SoundContext";
import { GameProvider } from "@/context/GameContext";
import Home from "@/pages/Home";
import CreateGame from "@/pages/CreateGame";
import GamePage from "@/pages/GamePage";
import Rules from "@/pages/Rules";
import Options from "@/pages/Options";
import Leaderboard from "@/pages/Leaderboard";
import Profile from "@/pages/Profile";
import User from "@/pages/User";
import About from "@/pages/About";
import NotFound from "@/pages/NotFound";
export default function App() {
   const { pathname } = useLocation();
   useEffect(() => {
      window.scrollTo(0, 0);
   }, [pathname]);
   return (
      <ThemeProvider>
         <AuthProvider>
            <PreferencesProvider>
               <SoundProvider>
                  <GameProvider>
                     <a className="skip-link" href="#page-content">
                        Skip to content
                     </a>
                     <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/play" element={<CreateGame />} />
                        <Route path="/game/create" element={<CreateGame />} />
                        <Route
                           path="/game/single-play"
                           element={<GamePage />}
                        />
                        <Route path="/rules" element={<Rules />} />
                        <Route path="/options" element={<Options />} />
                        <Route
                           path="/stats"
                           element={<Navigate to="/leaderboard" replace />}
                        />
                        <Route path="/leaderboard" element={<Leaderboard />} />
                        <Route path="/profile" element={<Profile />} />
                        <Route path="/user" element={<User />} />
                        <Route path="/about" element={<About />} />
                        <Route path="*" element={<NotFound />} />
                     </Routes>
                  </GameProvider>
               </SoundProvider>
            </PreferencesProvider>
         </AuthProvider>
      </ThemeProvider>
   );
}
