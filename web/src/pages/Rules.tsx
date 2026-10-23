import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink, RulesButton } from "@/components/Buttons";
import { Card } from "@/components/Card";
import { cardFanStyle } from "@/lib/cardFan";
import type { Card as CardCode } from "@/game/engine";
import containers from "@/styles/containers.module.css";
const SECTIONS = ["Overview", "Deal & Trump", "Play", "Scoring"] as const;
export default function Rules() {
   const [section, setSection] =
      useState<(typeof SECTIONS)[number]>("Overview");
   const cards: CardCode[] =
      section === "Deal & Trump"
         ? ["Js", "Jc", "As", "Ks", "Qs"]
         : ["9h", "10h", "Jh", "Qh", "Kh", "Ah"];
   return (
      <>
         <Helmet>
            <title>Rules | Euchre</title>
         </Helmet>
         <PageLayout title="RULES">
            <div className={containers["rules-body-container"]}>
               <div
                  className={containers["rules-button-container"]}
                  role="group"
                  aria-label="Rules sections"
               >
                  {SECTIONS.map((name) => (
                     <RulesButton
                        key={name}
                        name={name}
                        selected={section === name}
                        onClick={() => setSection(name)}
                     />
                  ))}
               </div>
               <article
                  className={containers["rules-text-body"]}
                  aria-label={section}
               >
                  <h2>{section}</h2>
                  {section === "Overview" && (
                     <>
                        <p>
                           Euchre is played by four players in two partnerships,
                           with partners sitting across from one another. You
                           and your partner share a score and work together to
                           win tricks.
                        </p>
                        <p>
                           The deck contains the 9, 10, jack, queen, king, and
                           ace of each suit, for 24 cards in all. Each player is
                           dealt five cards.
                        </p>
                        <p>
                           A hand consists of five <strong>tricks</strong>. One
                           player begins a trick by leading a card, and each
                           other active player adds one card in turn. The
                           winning card takes the trick. Before play begins, one
                           suit is chosen as <strong>trump</strong>; cards in
                           that suit outrank cards in the other suits.
                        </p>
                        <p>
                           The partnership that chooses trump is called the
                           makers, and their opponents are the defenders. The
                           makers must take at least three of the five tricks to
                           score. Taking all five is a <strong>march</strong>;
                           taking fewer than three means the makers have been{" "}
                           <strong>euchred</strong>.
                        </p>
                        <p>
                           Points are added to the partnership’s running score
                           after each hand. The first partnership to reach 10
                           points wins the game.
                        </p>
                     </>
                  )}
                  {section === "Deal & Trump" && (
                     <>
                        <p>
                           Beginning on the dealer’s left, cards are dealt
                           clockwise in a round of two followed by a round of
                           three, giving each player five cards. The next card
                           is turned face up on the remaining pack (the kitty). 
                           This is the <strong>turn-up</strong>.
                        </p>
                        <p>
                           Starting on the dealer’s left and continuing
                           clockwise, each player may pass or accept the
                           turn-up’s suit as trump. Accepting it is called
                           ordering up. Once someone orders up, bidding ends:
                           the dealer adds the turn-up to their hand and
                           discards one card face down, returning to five cards.
                        </p>
                        <p>
                           If all four players pass, the turn-up is turned down.
                           A second round begins in the same order, and each
                           player may pass or name any of the other three suits
                           as trump. The rejected suit cannot be chosen. If
                           everyone passes again, the cards are reshuffled and
                           the same dealer deals a fresh hand. If both bidding
                           rounds pass again on that redeal, the deal moves to
                           the next player clockwise. Calling trump resets this
                           count. Passed-out hands score no points.
                        </p>
                        <p>
                           The player who names trump may declare that they are{" "}
                           <strong>going alone</strong> at the time of their
                           call. Their partner sits out for that hand, leaving
                           three active players. If the turn-up was ordered up,
                           the dealer still picks it up and discards before play
                           begins.
                        </p>
                        <p>
                           The highest trump is the <strong>right bower</strong>
                           , the jack of the trump suit. Next comes the{" "}
                           <strong>left bower</strong>, the jack of the other
                           suit of the same color. The remaining trumps rank
                           ace, king, queen, 10, and 9.
                        </p>
                        <p>
                           The left bower belongs to the trump suit for the
                           entire hand, regardless of the suit printed on the
                           card. In the other suits, the remaining cards rank
                           ace, king, queen, jack, 10, and 9, from highest to
                           lowest.
                        </p>
                     </>
                  )}
                  {section === "Play" && (
                     <>
                        <p>
                           The first active player on the dealer’s left makes
                           the opening lead, and play continues clockwise. If
                           that seat belongs to the partner of someone going
                           alone, it is skipped. Any card may be led, including
                           trump.
                        </p>
                        <p>
                           When a suit is led, you must play a card of that suit
                           if you have one. If you cannot follow suit, you may
                           play a trump card or discard any other card. You do
                           not have to play trump simply because you are out of
                           the suit led.
                        </p>
                        <p>
                           Remember that the left bower counts as trump when
                           following suit. For example, when spades are trump,
                           the jack of clubs counts as a spade. If clubs are led
                           and that jack is your only card printed with a club,
                           you have no clubs to follow with and may play any
                           card.
                        </p>
                        <p>
                           A trick containing trump is won by its highest trump
                           card. Otherwise, the highest card of the suit led
                           wins. The winner leads the next trick, and play
                           continues until all five tricks have been taken.
                        </p>
                     </>
                  )}
                  {section === "Scoring" && (
                     <>
                        <p>
                           Only one partnership earns points in a hand. The
                           makers are the team that chose trump, even when their
                           caller plays alone. After all five tricks, points are
                           awarded as follows:
                        </p>
                        <dl className="scoring-rules">
                           <div>
                              <dt>Makers take 3–4 tricks</dt>
                              <dd>1 point</dd>
                           </div>
                           <div>
                              <dt>Makers take all 5</dt>
                              <dd>2 points</dd>
                           </div>
                           <div>
                              <dt>Lone maker takes 3–4 tricks</dt>
                              <dd>1 point</dd>
                           </div>
                           <div>
                              <dt>Lone maker takes all 5</dt>
                              <dd>4 points</dd>
                           </div>
                           <div>
                              <dt>Makers take fewer than 3</dt>
                              <dd>Defenders get 2 points</dd>
                           </div>
                        </dl>
                        <p>
                           Being euchred awards the defenders two points whether
                           the makers played together or alone. A lone player’s
                           points still count toward their partnership’s total.
                           The next player clockwise deals the following hand,
                           and the game continues until a partnership reaches 10
                           points.
                        </p>
                     </>
                  )}
                  {(section === "Overview" || section === "Deal & Trump") && (
                     <figure className="rules-example">
                        <div
                           className="rules-card-fan"
                           aria-label="Example cards"
                        >
                           {cards.map((code, i) => (
                              <div
                                 key={code}
                                 style={cardFanStyle(i, cards.length)}
                              >
                                 <Card
                                    code={code}
                                    trump={section === "Deal & Trump" ? "s" : null}
                                 />
                              </div>
                           ))}
                        </div>
                        {section === "Deal & Trump" && (
                           <figcaption>
                              With spades as trump, both jacks count as spades.
                           </figcaption>
                        )}
                     </figure>
                  )}
               </article>
            </div>
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
