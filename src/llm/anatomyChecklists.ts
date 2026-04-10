import type { StudyMetadata } from '../dicom/types';

export interface AnatomyItem {
  id: string;
  label: string;
  defaultChecked: boolean;
}

interface ChecklistResult {
  bodyPart: string;
  displayName: string;
  structures: AnatomyItem[];
}

const CHECKLISTS: Record<string, { displayName: string; structures: AnatomyItem[] }> = {
  knee: {
    displayName: 'Knee',
    structures: [
      { id: 'acl', label: 'ACL', defaultChecked: true },
      { id: 'pcl', label: 'PCL', defaultChecked: true },
      { id: 'mcl', label: 'MCL', defaultChecked: true },
      { id: 'lcl', label: 'LCL / Posterolateral corner', defaultChecked: true },
      { id: 'medial-meniscus', label: 'Medial meniscus', defaultChecked: true },
      { id: 'lateral-meniscus', label: 'Lateral meniscus', defaultChecked: true },
      { id: 'articular-cartilage', label: 'Articular cartilage', defaultChecked: true },
      { id: 'patellar-tendon', label: 'Patellar tendon / Quadriceps tendon', defaultChecked: true },
      { id: 'bone-marrow', label: 'Bone marrow signal', defaultChecked: true },
      { id: 'joint-effusion', label: 'Joint effusion', defaultChecked: true },
      { id: 'bakers-cyst', label: "Baker's cyst / Popliteal fossa", defaultChecked: false },
    ],
  },
  shoulder: {
    displayName: 'Shoulder',
    structures: [
      { id: 'supraspinatus', label: 'Supraspinatus tendon', defaultChecked: true },
      { id: 'infraspinatus', label: 'Infraspinatus tendon', defaultChecked: true },
      { id: 'subscapularis', label: 'Subscapularis tendon', defaultChecked: true },
      { id: 'teres-minor', label: 'Teres minor', defaultChecked: false },
      { id: 'biceps-tendon', label: 'Long head biceps tendon', defaultChecked: true },
      { id: 'labrum', label: 'Glenoid labrum', defaultChecked: true },
      { id: 'ac-joint', label: 'Acromioclavicular joint', defaultChecked: true },
      { id: 'subacromial', label: 'Subacromial / subdeltoid bursa', defaultChecked: true },
      { id: 'bone-marrow', label: 'Bone marrow signal', defaultChecked: true },
      { id: 'joint-effusion', label: 'Glenohumeral effusion', defaultChecked: false },
    ],
  },
  brain: {
    displayName: 'Brain',
    structures: [
      { id: 'cortex', label: 'Cerebral cortex / Gray-white differentiation', defaultChecked: true },
      { id: 'white-matter', label: 'White matter signal', defaultChecked: true },
      { id: 'ventricles', label: 'Ventricular system', defaultChecked: true },
      { id: 'basal-ganglia', label: 'Basal ganglia / Thalami', defaultChecked: true },
      { id: 'posterior-fossa', label: 'Posterior fossa / Cerebellum', defaultChecked: true },
      { id: 'brainstem', label: 'Brainstem', defaultChecked: true },
      { id: 'midline', label: 'Midline structures', defaultChecked: true },
      { id: 'extra-axial', label: 'Extra-axial spaces', defaultChecked: true },
      { id: 'orbits', label: 'Orbits (if included)', defaultChecked: false },
      { id: 'sinuses', label: 'Paranasal sinuses', defaultChecked: false },
    ],
  },
  spine: {
    displayName: 'Spine',
    structures: [
      { id: 'vertebral-bodies', label: 'Vertebral body alignment / height', defaultChecked: true },
      { id: 'discs', label: 'Intervertebral discs', defaultChecked: true },
      { id: 'spinal-cord', label: 'Spinal cord signal', defaultChecked: true },
      { id: 'neural-foramina', label: 'Neural foramina', defaultChecked: true },
      { id: 'central-canal', label: 'Central canal stenosis', defaultChecked: true },
      { id: 'facet-joints', label: 'Facet joints', defaultChecked: true },
      { id: 'ligaments', label: 'Ligaments (ALL, PLL)', defaultChecked: false },
      { id: 'paraspinal', label: 'Paraspinal soft tissues', defaultChecked: false },
      { id: 'bone-marrow', label: 'Bone marrow signal', defaultChecked: true },
    ],
  },
  chest: {
    displayName: 'Chest',
    structures: [
      { id: 'lungs', label: 'Lung parenchyma', defaultChecked: true },
      { id: 'airways', label: 'Airways / Bronchi', defaultChecked: true },
      { id: 'mediastinum', label: 'Mediastinum', defaultChecked: true },
      { id: 'heart', label: 'Heart / Pericardium', defaultChecked: true },
      { id: 'aorta', label: 'Thoracic aorta', defaultChecked: true },
      { id: 'lymph-nodes', label: 'Lymph nodes', defaultChecked: true },
      { id: 'pleura', label: 'Pleura / Pleural space', defaultChecked: true },
      { id: 'chest-wall', label: 'Chest wall / Bones', defaultChecked: false },
      { id: 'upper-abdomen', label: 'Visualized upper abdomen', defaultChecked: false },
    ],
  },
  abdomen: {
    displayName: 'Abdomen',
    structures: [
      { id: 'liver', label: 'Liver', defaultChecked: true },
      { id: 'gallbladder', label: 'Gallbladder / Biliary system', defaultChecked: true },
      { id: 'pancreas', label: 'Pancreas', defaultChecked: true },
      { id: 'spleen', label: 'Spleen', defaultChecked: true },
      { id: 'kidneys', label: 'Kidneys / Adrenals', defaultChecked: true },
      { id: 'aorta', label: 'Abdominal aorta / IVC', defaultChecked: true },
      { id: 'lymph-nodes', label: 'Lymph nodes', defaultChecked: true },
      { id: 'bowel', label: 'Bowel', defaultChecked: true },
      { id: 'pelvis', label: 'Pelvic organs (if included)', defaultChecked: false },
      { id: 'bones', label: 'Osseous structures', defaultChecked: false },
    ],
  },
};

const BODY_PART_PATTERNS: [RegExp, string][] = [
  [/\bknee\b/i, 'knee'],
  [/\bshoulder\b/i, 'shoulder'],
  [/\bbrain\b|\bhead\b|\bcranial\b|\bneurocranium\b/i, 'brain'],
  [/\bspine\b|\blumbar\b|\bcervical\b|\bthoracic\b|\blspine\b|\bcspine\b/i, 'spine'],
  [/\bchest\b|\bthorax\b|\blung\b|\bpulmonary\b/i, 'chest'],
  [/\babdomen\b|\babdominal\b|\bpelvis\b|\bliver\b|\brenal\b|\bkidney\b/i, 'abdomen'],
];

/**
 * Detect body part from study/series descriptions.
 */
export function detectBodyPart(metadata: StudyMetadata): string {
  // Build a search string from study description + all series descriptions
  const searchText = [
    metadata.studyDescription,
    metadata.bodyPartExamined ?? '',
    ...metadata.series.map((s) => s.seriesDescription ?? ''),
  ].join(' ');

  for (const [pattern, bodyPart] of BODY_PART_PATTERNS) {
    if (pattern.test(searchText)) return bodyPart;
  }

  return 'unknown';
}

/**
 * Get anatomy checklist for a body part.
 */
export function getChecklist(bodyPart: string): ChecklistResult {
  const entry = CHECKLISTS[bodyPart];
  if (!entry) {
    return {
      bodyPart: 'unknown',
      displayName: 'General',
      structures: [
        { id: 'primary-findings', label: 'Primary findings', defaultChecked: true },
        { id: 'additional', label: 'Additional observations', defaultChecked: true },
      ],
    };
  }
  return {
    bodyPart,
    displayName: entry.displayName,
    structures: entry.structures.map((s) => ({ ...s })),
  };
}

/**
 * Build a structured clinical hint for survey mode.
 */
export function buildSurveyHint(bodyPart: string, selectedIds: string[]): string {
  const checklist = getChecklist(bodyPart);
  const selectedLabels = checklist.structures
    .filter((s) => selectedIds.includes(s.id))
    .map((s) => s.label);

  return (
    `Perform a systematic survey of this ${checklist.displayName.toLowerCase()} study. ` +
    `For each of the following structures, assess for any abnormalities:\n` +
    selectedLabels.map((label) => `- ${label}`).join('\n')
  );
}
