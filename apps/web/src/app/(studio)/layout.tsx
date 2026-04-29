import StudioLayout from "@/components/layout/StudioLayout";
import { ProjectProvider } from "@/contexts/ProjectContext";

export default function StudioGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <StudioLayout>{children}</StudioLayout>
    </ProjectProvider>
  );
}
