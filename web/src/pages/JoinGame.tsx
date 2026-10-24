import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { LoginWarning } from "@/components/LoginWarning";

export default function JoinGame() {
   const [code, setCode] = useState("");
   const navigate = useNavigate();
   return (
      <>
         <Helmet>
            <title>Join Game | Euchre</title>
         </Helmet>
         <PageLayout title="JOIN GAME">
            <div className="multiplayer-join">
               <h2>Enter the lobby code</h2>
               <p>
                  The game host can provide you with a code, or simply visit the
                  game lobby link.
               </p>
               <form
                  onSubmit={(e) => {
                     e.preventDefault();
                     if (code.trim())
                        navigate(`/game/lobby/${code.trim().toUpperCase()}`);
                  }}
               >
                  <label>
                     <span className="sr-only">Lobby code</span>
                     <input
                        aria-label="Lobby code"
                        placeholder="Lobby Code"
                        value={code}
                        autoCapitalize="characters"
                        autoComplete="off"
                        maxLength={6}
                        pattern="[A-Za-z0-9]{6}"
                        required
                        onChange={(e) =>
                           setCode(
                              e.target.value
                                 .replace(/[^A-Za-z0-9]/g, "")
                                 .toUpperCase()
                           )
                        }
                     />
                  </label>
                  <LoginWarning />
                  <div className="button-stack">
                     <Button
                        name="Join!"
                        type="submit"
                        disabled={code.length !== 6}
                     />
                     <MenuLink to="/" name="Home" />
                  </div>
               </form>
            </div>
         </PageLayout>
      </>
   );
}
