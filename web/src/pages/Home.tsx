import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCards } from "@fortawesome/pro-regular-svg-icons";
import { Navbar } from "@/components/Navbar";
import { EuchreLogo } from "@/components/EuchreLogo";
import { MenuLink } from "@/components/Buttons";
import containers from "@/styles/containers.module.css";
export default function Home() {
   return (
      <>
         <Helmet>
            <title>Euchre</title>
         </Helmet>
         <main className={containers["content-border-container-menu"]}>
            <Navbar />
            <motion.div
               id="page-content"
               tabIndex={-1}
               className={containers["index-container"]}
               initial={{ opacity: 0, y: -12 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ duration: 0.25 }}
            >
               <div className={containers["title-container"]}>
                  <EuchreLogo
                     style={{
                        marginTop: "-100px",
                        transform: "translateY(-24px)",
                        display: "block",
                        marginLeft: "auto",
                        marginRight: "auto",
                     }}
                  />
                  <h1 style={{ marginTop: "-180px" }}>EUCHRE</h1>
               </div>
               <div className={containers["menu-button-container"]}>
                  <MenuLink to="/play" name="Play" />
                  <MenuLink to="/leaderboard" name="Leaderboard" />
                  <MenuLink to="/rules" name="Rules" />
                  <MenuLink to="/about" name="About" />
               </div>
            </motion.div>
            <motion.a
               className={containers["cards-hub-link"]}
               href={
                  import.meta.env.DEV
                     ? "http://localhost:3000/"
                     : "https://cards.shmem.dev/"
               }
               aria-label="Cards home"
               title="Cards home"
               initial={{ opacity: 0, y: -12 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: 12 }}
               transition={{ duration: 0.25, ease: "easeOut" }}
            >
               <FontAwesomeIcon icon={faCards} />
            </motion.a>
         </main>
      </>
   );
}
