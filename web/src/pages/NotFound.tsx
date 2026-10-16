import { Helmet } from "react-helmet-async";
import { PageLayout } from "@/components/ui/PageLayout";
import { MenuLink } from "@/components/Buttons";
export default function NotFound() {
   return (
      <>
         <Helmet>
            <title>Page Not Found | Euchre</title>
         </Helmet>
         <PageLayout title="404">
            <p>Page not found!</p>
            <div className="button-stack">
               <MenuLink to="/" name="Home" />
            </div>
         </PageLayout>
      </>
   );
}
