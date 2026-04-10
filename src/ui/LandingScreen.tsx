import { Archive, BrainCircuit, Download, MessageSquareMore, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';

interface LandingScreenProps {
  children: ReactNode;
}

const workflow = [
  {
    label: 'Load the study',
    detail: 'Drop a local DICOM folder and let Cornerstone organize the series, geometry, and slice order.',
    icon: Download,
  },
  {
    label: 'Ask the AI',
    detail: 'Start with one focused clinical question. Dr.MRI.AI chooses the right series and slices before it analyzes anything.',
    icon: BrainCircuit,
  },
  {
    label: 'Inspect the evidence',
    detail: 'Jump from the report back to referenced slices, challenge findings, and export the reviewed evidence when needed.',
    icon: ScanSearch,
  },
];

export default function LandingScreen({ children }: LandingScreenProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_24%),radial-gradient(circle_at_80%_12%,_rgba(45,212,191,0.12),_transparent_22%),linear-gradient(180deg,_#060816_0%,_#080b14_42%,_#05060b_100%)] px-6 py-10 text-white md:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <section className="flex min-h-[32rem] flex-col justify-between rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(14,18,32,0.92),rgba(8,12,20,0.78)_48%,rgba(11,25,26,0.88)_100%)] p-7 shadow-[0_35px_120px_rgba(0,0,0,0.45)] md:p-10">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-200/8 px-4 py-1.5 text-[11px] uppercase tracking-[0.28em] text-amber-100/85">
                <BrainCircuit className="h-4 w-4" />
                AI-first MRI reading workspace
              </div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                Developed by Rabimba
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm uppercase tracking-[0.34em] text-teal-200/70">
                Dr.MRI.AI
              </div>
              <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.05em] text-white md:text-6xl">
                Ask the question.
                <br />
                Let the AI build the read around the evidence.
              </h1>
            </div>

            <p className="mt-5 max-w-2xl text-base leading-7 text-white/70">
              Dr.MRI.AI plans the slice selection, produces a focused report, keeps the follow-up chat alive, and lets you export both the findings and the reviewed JPEG evidence in one bundle.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/72">
                Ollama-first local workflow
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/72">
                Slice planning before image analysis
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/72">
                Export report-only or evidence bundle ZIP
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {workflow.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-[24px] border border-white/10 bg-black/18 p-4 backdrop-blur-md">
                  <Icon className="h-5 w-5 text-amber-200/80" />
                  <div className="mt-4 text-sm font-medium text-white">{item.label}</div>
                  <p className="mt-2 text-sm leading-6 text-white/58">{item.detail}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,14,24,0.92),rgba(8,10,18,0.94))] p-5 shadow-[0_30px_100px_rgba(0,0,0,0.42)] md:p-6">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
              <MessageSquareMore className="h-4 w-4" />
              Start here
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
              Upload a study, then tell Dr.MRI.AI what matters.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/60">
              Good prompts are specific: anatomy, suspected pathology, desired confidence, and what uncertainty matters clinically.
            </p>
          </div>

          <div className="mt-6 flex-1">
            {children}
          </div>

          <div className="mt-6 space-y-3 rounded-[24px] border border-white/10 bg-black/18 p-4 text-sm text-white/62">
            <div>
              Example starts:
            </div>
            <div className="flex items-start gap-2 text-xs text-teal-100/75">
              <Archive className="mt-0.5 h-4 w-4 shrink-0" />
              After the first read, export a ZIP containing the report, JSON summary, and reviewed evidence slices.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                'Evaluate ACL integrity and grade any tear.',
                'Look for focal liver lesion or portal venous abnormality.',
                'Summarize the dominant finding and what remains uncertain.',
              ].map((prompt) => (
                <span key={prompt} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/72">
                  {prompt}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
