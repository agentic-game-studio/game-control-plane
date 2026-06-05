import StudioLayout from "@/components/layout/StudioLayout";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { DialogProvider } from "@/hooks/useDialog";

export default function StudioGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <DialogProvider>
        <StudioLayout>{children}</StudioLayout>
      </DialogProvider>
    </ProjectProvider>
  );
}
