import React from "react";
import containers from "@/styles/containers.module.css";
import { Navbar } from "@/components/Navbar";
import { EuchreLogo } from "@/components/EuchreLogo";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { SettingsGear } from "@/components/SettingsGear";

function AccountSettings() {
   const { user } = useAuth();
   const { pathname } = useLocation();
   if (!user || !["/user", "/profile", "/options"].includes(pathname))
      return null;
   return (
      <div className="account-settings">
         <SettingsGear exclude={pathname} />
      </div>
   );
}

export type PageLayoutVariant = "default" | "menu";

export interface PageLayoutProps {
   title: string;
   children: React.ReactNode;
   variant?: PageLayoutVariant;
   /** Applied to the wrapper that contains the title block and children */
   contentClassName?: string;
   /** Applied to the children wrapper (body content area) */
   className?: string;
   /** When true, do not show the hearts logo or title */
   hideTitleBlock?: boolean;
}

const bodyContentClasses =
   "mt-6 w-full px-2 flex flex-col items-center justify-center text-center";

export const PageLayout: React.FC<PageLayoutProps> = ({
   title,
   children,
   variant = "default",
   contentClassName,
   className,
   hideTitleBlock = false,
}) => (
   <div
      style={{ position: "relative" }}
      className={
         variant === "menu"
            ? "w-full max-w-[1030px] mx-auto p-9 pb-[120px] box-border mt-5 mb-5 bg-transparent"
            : containers["content-border-container"]
      }
   >
      <Navbar />
      <AccountSettings />
      <motion.div
         initial={{ opacity: 0, y: -12 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: 12 }}
         transition={{ duration: 0.25, ease: "easeOut" }}
         className={`flex flex-col items-center justify-center ${
            hideTitleBlock ? "mt-2 sm:mt-6" : "mt-[50px] sm:mt-[140px]"
         } ${contentClassName ?? ""}`.trim()}
      >
         {!hideTitleBlock && (
            <div className={containers["title-container"]}>
               <EuchreLogo size={212} />
               <h1>{title}</h1>
            </div>
         )}
         <div
            id="page-content"
            tabIndex={-1}
            className={className ?? bodyContentClasses}
         >
            {children}
         </div>
      </motion.div>
   </div>
);
