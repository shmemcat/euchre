import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "@/styles/buttons.module.css";
type ButtonProps = {
   name: string;
   disabled?: boolean;
   onClick?: () => void;
   style?: CSSProperties;
   type?: "button" | "submit" | "reset";
   children?: ReactNode;
};
export function Button({
   name,
   disabled,
   onClick,
   style,
   type = "button",
   children,
}: ButtonProps) {
   return (
      <button
         className={styles["menu-button"]}
         disabled={disabled}
         onClick={onClick}
         style={style}
         type={type}
      >
         <span className={styles["button-shine"]} aria-hidden="true" />
         {children ?? name}
      </button>
   );
}
export function MenuLink({ to, name }: { to: string; name: string }) {
   return (
      <Link className={`${styles["menu-button"]} menu-link`} to={to}>
         <span className={styles["button-shine"]} aria-hidden="true" />
         {name}
      </Link>
   );
}
export function RulesButton({
   name,
   selected,
   onClick,
}: {
   name: string;
   selected: boolean;
   onClick: () => void;
}) {
   return (
      <button
         type="button"
         data-selected={selected}
         aria-pressed={selected}
         onClick={onClick}
         className={`${
            selected ? styles["rules-button-selected"] : styles["rules-button"]
         } rules-tab`}
      >
         {name}
      </button>
   );
}
