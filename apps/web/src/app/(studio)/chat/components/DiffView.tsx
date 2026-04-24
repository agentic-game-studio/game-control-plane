"use client";

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  filePath: string;
}

interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNum: number;
}

function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: DiffLine[] = [];
  let lineNum = 1;

  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: "context", content: oldLines[i], lineNum });
      i++;
      j++;
      lineNum++;
    } else if (i < oldLines.length) {
      const foundIndex = newLines.slice(j).indexOf(oldLines[i]);
      if (foundIndex >= 0 && foundIndex < 3) {
        for (let k = 0; k < foundIndex; k++) {
          result.push({ type: "add", content: newLines[j + k], lineNum });
          lineNum++;
        }
        j += foundIndex;
      } else {
        result.push({ type: "remove", content: oldLines[i], lineNum: 0 });
        i++;
      }
    } else if (j < newLines.length) {
      result.push({ type: "add", content: newLines[j], lineNum });
      j++;
      lineNum++;
    } else {
      break;
    }
  }

  return result;
}

export default function DiffView({ oldContent, newContent, filePath }: DiffViewProps) {
  const diffLines = computeDiff(oldContent, newContent);

  return (
    <div className="border-2 border-black bg-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] my-2 overflow-hidden">
      <div className="bg-black px-4 py-2 flex items-center gap-3">
        <span className="material-symbols-outlined text-white text-sm">difference</span>
        <span className="font-[var(--font-terminal)] text-xs text-white uppercase tracking-wider">
          {filePath}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody className="font-[var(--font-terminal)] text-xs">
            {diffLines.map((line, idx) => (
              <tr
                key={idx}
                className={
                  line.type === "add"
                    ? "bg-[#e7f0ff]"
                    : line.type === "remove"
                    ? "bg-[#ffe7e7]"
                    : ""
                }
              >
                <td className="px-2 py-1 text-right text-[#737688] select-none w-8 border-r border-[#e1e1ef] min-w-[2rem]">
                  {line.type === "remove" ? "-" : line.lineNum || ""}
                </td>
                <td className="px-3 py-1 whitespace-pre">
                  {line.type === "add" && (
                    <span className="text-[#0055FF] font-bold mr-2">+</span>
                  )}
                  {line.type === "remove" && (
                    <span className="text-[#df2b31] font-bold mr-2">-</span>
                  )}
                  {line.type === "context" && (
                    <span className="text-[#737688] mr-2"> </span>
                  )}
                  <span className={
                    line.type === "add"
                      ? "text-[#0041c8]"
                      : line.type === "remove"
                      ? "text-[#ba061b]"
                      : "text-[#191b25]"
                  }>
                    {line.content}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
