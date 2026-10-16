import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faClub,
   faDiamond,
   faSpade,
   faHeart,
} from "@fortawesome/pro-solid-svg-icons";
import {
   cardName,
   rankOf,
   suitOf,
   type Card as CardCode,
   type Suit,
} from "@/game/engine";
import { usePreferences } from "@/context/PreferencesContext";
import { asset } from "@/lib/assets";
import styles from "@/styles/card.module.css";
export const SUIT_ICONS = { c: faClub, d: faDiamond, s: faSpade, h: faHeart };
export function SuitIcon({ suit }: { suit: Suit }) {
   return (
      <FontAwesomeIcon
         icon={SUIT_ICONS[suit]}
         className={suit === "d" || suit === "h" ? "red-suit" : "black-suit"}
      />
   );
}
export function Card({
   code,
   onClick,
   disabled = false,
   selected = false,
   small = false,
   styleOverride,
}: {
   code: CardCode;
   onClick?: () => void;
   disabled?: boolean;
   selected?: boolean;
   small?: boolean;
   styleOverride?: "celestial" | "classic";
}) {
   const { preferences } = usePreferences();
   const style = styleOverride ?? preferences.cardStyle;
   const suit = suitOf(code);
   const red = suit === "d" || suit === "h";
   const className = [
      styles.card,
      small ? styles.cardSmall : "",
      style === "celestial" ? styles.cardImage : "",
      disabled ? styles.cardDisabled : "",
      selected ? styles.cardSelected : "",
      "euchre-card",
   ].join(" ");
   const content =
      style === "celestial" ? (
         <img
            src={asset(`cards/${code}.svg`)}
            alt=""
            className={styles.cardImg}
            draggable={false}
         />
      ) : (
         <span className={styles.cardLabel}>
            <span className={red ? styles.rankRed : styles.rankBlack}>
               {rankOf(code)}
            </span>
            <SuitIcon suit={suit} />
         </span>
      );
   return onClick ? (
      <button
         className={className}
         type="button"
         aria-label={cardName(code)}
         disabled={disabled}
         aria-pressed={selected ? true : undefined}
         onClick={onClick}
      >
         {content}
      </button>
   ) : (
      <div className={className} role="img" aria-label={cardName(code)}>
         {content}
      </div>
   );
}
