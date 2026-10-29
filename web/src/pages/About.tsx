import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
import { Sparkle } from "@/components/Sparkle";
export default function About() {
   return (
      <>
         <Helmet>
            <title>About | Euchre</title>
         </Helmet>
         <PageLayout title="ABOUT">
            <article className="about-body">
               <p>
                  Welcome to my <strong className="bold">Euchre</strong> web
                  app! I’m <strong className="bold">Emily</strong>, aka{" "}
                  <strong className="bold">
                     <span className="sparkle-container">
                        <Sparkle className="sparkle-svg" />
                        <Sparkle className="sparkle-svg" />
                        <Sparkle className="sparkle-svg" />
                        <Sparkle className="sparkle-svg" />
                        <Sparkle className="sparkle-svg" />
                        <span className="sparkle">shmemcat</span>
                     </span>
                  </strong>
                  . Euchre is one of my family’s favorite card games, and we
                  played it constantly growing up. I wanted to bring it to the
                  web so we could play it together no matter how far apart we
                  are!
               </p>
               <p>
                  Euchre is part of my{" "}
                  <a className="link" href="https://cards.shmem.dev/">
                     Cards
                  </a>{" "}
                  project, alongside{" "}
                  <a className="link" href="https://cards.shmem.dev/hearts/">
                     Hearts
                  </a>
                  ,{" "}
                  <a className="link" href="https://cards.shmem.dev/golf/">
                     Golf
                  </a>
                  , and{" "}
                  <a className="link" href="https://cards.shmem.dev/hand-and-foot/">
                     Hand and Foot
                  </a>
                  . Find the code on{" "}
                  <a
                     className="link"
                     href="https://github.com/shmemcat/euchre"
                     target="_blank"
                     rel="noreferrer"
                  >
                     GitHub
                  </a>
                  .
               </p>
               <p>
                  Credit for this lovely music you’re listening to
                  <br />
                  goes to{" "}
                  <a
                     className="link"
                     href="https://pixabay.com/users/sonican-38947841/"
                     target="_blank"
                     rel="noreferrer"
                  >
                     Sonican
                  </a>
                  ,{" "}
                  <a
                     className="link"
                     href="https://pixabay.com/users/zephiramusic-54643547/"
                     target="_blank"
                     rel="noreferrer"
                  >
                     ZephiraMusic
                  </a>
                  ,{" "}
                  <a
                     className="link"
                     href="https://pixabay.com/users/alex-morgan-54692529/"
                     target="_blank"
                     rel="noreferrer"
                  >
                     Alex Morgan
                  </a>
                  , and{" "}
                  <a
                     className="link"
                     href="https://pixabay.com/users/velariomusic-54515099/"
                     target="_blank"
                     rel="noreferrer"
                  >
                     VelarioMusic
                  </a>
                  !
               </p>
            </article>
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
