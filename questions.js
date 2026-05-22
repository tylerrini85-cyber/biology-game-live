// Cellular respiration questions — 40 total, flat pool (not tied to any level)
// Game shuffles all 40 on Start. No repeats within a single playthrough.
// Each new game = fresh shuffle, different starting question.

const QUESTIONS = [
  { q: "What is cellular respiration?",
    choices: ["How plants make food", "How DNA replicates", "The process cells use to break down glucose to make ATP (energy)", "How proteins are built"],
    correct: 2,
    explain: "Cellular respiration is how cells break down glucose to produce ATP — the energy molecule of the cell." },

  { q: "What is the main purpose of cellular respiration?",
    choices: ["To produce ATP for the cell", "To digest food", "To make glucose", "To copy DNA"],
    correct: 0,
    explain: "The whole point is to produce ATP — the cell's energy currency." },

  { q: "What molecule is the main fuel for cellular respiration?",
    choices: ["Protein", "Glucose", "Fat", "Water"],
    correct: 1,
    explain: "Glucose — a 6-carbon sugar — is the main fuel for cellular respiration." },

  { q: "What gas is needed for aerobic cellular respiration?",
    choices: ["Nitrogen", "Carbon dioxide", "Oxygen", "Hydrogen"],
    correct: 2,
    explain: "Aerobic respiration needs oxygen to accept electrons at the end of the ETC." },

  { q: "What gas is released during cellular respiration?",
    choices: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"],
    correct: 1,
    explain: "Carbon dioxide (CO₂) is the waste gas — what you exhale." },

  { q: "What liquid is produced during cellular respiration?",
    choices: ["Oil", "Acid", "Water", "Sugar"],
    correct: 2,
    explain: "Water (H₂O) is formed when oxygen combines with electrons + hydrogen at the end of the ETC." },

  { q: "What is the energy molecule cells use?",
    choices: ["DNA", "ATP", "Glucose", "NADH"],
    correct: 1,
    explain: "ATP (adenosine triphosphate) — the cell's universal energy currency." },

  { q: "What organelle does cellular respiration mainly occur in?",
    choices: ["Mitochondria", "Nucleus", "Ribosome", "Vacuole"],
    correct: 0,
    explain: "Most of cellular respiration occurs in the mitochondria — the powerhouse of the cell." },

  { q: "What is the first stage of cellular respiration?",
    choices: ["Krebs cycle", "Glycolysis", "Electron transport chain", "Fermentation"],
    correct: 1,
    explain: "Glycolysis is the first stage — it breaks glucose down in the cytoplasm." },

  { q: "Where does glycolysis occur?",
    choices: ["Mitochondria", "Nucleus", "Cytoplasm", "Ribosome"],
    correct: 2,
    explain: "Glycolysis happens in the cytoplasm — the fluid inside the cell." },

  { q: "What does glycolysis break down?",
    choices: ["Protein", "Glucose", "Fat", "DNA"],
    correct: 1,
    explain: "Glycolysis splits glucose into 2 pyruvate molecules." },

  { q: "How many ATP are made during glycolysis (net gain)?",
    choices: ["0", "2", "36", "100"],
    correct: 1,
    explain: "Glycolysis nets 2 ATP — makes 4, spends 2 to activate glucose." },

  { q: "What are the two main stages after glycolysis?",
    choices: ["Krebs cycle and electron transport chain", "Fermentation and Krebs cycle", "DNA replication and glycolysis", "Photosynthesis and ETC"],
    correct: 0,
    explain: "After glycolysis comes the Krebs cycle, then the electron transport chain." },

  { q: "Where does the Krebs cycle occur?",
    choices: ["Cytoplasm", "Mitochondria", "Nucleus", "Ribosome"],
    correct: 1,
    explain: "The Krebs cycle takes place in the mitochondrial matrix." },

  { q: "What is another name for the Krebs cycle?",
    choices: ["Citric acid cycle", "Sugar cycle", "Water cycle", "ATP cycle"],
    correct: 0,
    explain: "Also called the citric acid cycle — because the first product is citric acid (citrate)." },

  { q: "What is the final stage of cellular respiration?",
    choices: ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"],
    correct: 2,
    explain: "The electron transport chain (ETC) is the final and most ATP-productive stage." },

  { q: "Where does the electron transport chain occur?",
    choices: ["Cytoplasm", "Inner membrane of the mitochondria", "Outer membrane", "Nucleus"],
    correct: 1,
    explain: "The ETC sits on the inner mitochondrial membrane." },

  { q: "Which stage makes the most ATP?",
    choices: ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"],
    correct: 2,
    explain: "The ETC produces the bulk of cellular ATP (~26-28 per glucose)." },

  { q: "What happens to glucose during cellular respiration?",
    choices: ["It is broken down into simpler molecules", "It is made into protein", "It is stored", "It becomes oxygen"],
    correct: 0,
    explain: "Glucose is broken down step by step into CO₂ and H₂O, releasing energy as ATP." },

  { q: "What is the balanced equation for cellular respiration?",
    choices: ["C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + ATP", "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", "C₆H₁₂O₆ → 2 Pyruvate", "ATP → ADP + P"],
    correct: 0,
    explain: "Glucose + oxygen → carbon dioxide + water + ATP. Memorize this equation!" },

  { q: "Is cellular respiration anabolic or catabolic?",
    choices: ["Anabolic", "Catabolic", "Neutral", "Reductive"],
    correct: 1,
    explain: "Catabolic — it breaks down a complex molecule (glucose) into smaller ones." },

  { q: "What does aerobic mean?",
    choices: ["Without oxygen", "Requiring oxygen", "With sunlight", "In water"],
    correct: 1,
    explain: "Aerobic = requires oxygen. Anaerobic = without oxygen." },

  { q: "What does anaerobic mean?",
    choices: ["With oxygen", "Without oxygen", "With sunlight", "In water"],
    correct: 1,
    explain: "Anaerobic = without oxygen. Glycolysis and fermentation are anaerobic." },

  { q: "What process happens if oxygen is not available?",
    choices: ["Krebs cycle", "Photosynthesis", "Fermentation", "Cellular death"],
    correct: 2,
    explain: "Without oxygen, cells switch to fermentation — much less ATP, but keeps going." },

  { q: "What type of fermentation occurs in muscle cells?",
    choices: ["Alcoholic fermentation", "Lactic acid fermentation", "Acetic acid fermentation", "Mixed fermentation"],
    correct: 1,
    explain: "Muscle cells produce lactic acid — that burning feeling during hard exercise." },

  { q: "What type of fermentation occurs in yeast?",
    choices: ["Lactic acid fermentation", "Alcoholic fermentation", "Acetic acid fermentation", "Mixed fermentation"],
    correct: 1,
    explain: "Yeast does alcoholic fermentation — used to make beer, wine, and bread." },

  { q: "How much ATP does fermentation produce?",
    choices: ["0", "2", "32", "100"],
    correct: 1,
    explain: "Only 2 ATP — way less than aerobic respiration's ~32 ATP." },

  { q: "Why is ATP important?",
    choices: ["It provides energy for cell activities", "It carries oxygen", "It builds DNA", "It stores fats"],
    correct: 0,
    explain: "ATP powers nearly every activity in the cell — muscle movement, building proteins, etc." },

  { q: "Which organisms perform cellular respiration?",
    choices: ["Only animals", "Only plants", "Plants and animals (and many other organisms)", "Only bacteria"],
    correct: 2,
    explain: "Nearly all living things — plants, animals, fungi, most bacteria — do cellular respiration." },

  { q: "Do plants perform cellular respiration?",
    choices: ["Yes", "No", "Only at night", "Only in spring"],
    correct: 0,
    explain: "Plants do BOTH photosynthesis and cellular respiration — they need ATP too." },

  { q: "How is cellular respiration related to photosynthesis?",
    choices: ["They are unrelated", "The products of one are the reactants of the other", "They are the same process", "Only photosynthesis makes ATP"],
    correct: 1,
    explain: "Cellular respiration's outputs (CO₂, H₂O) are photosynthesis's inputs, and vice versa." },

  { q: "What are the reactants of cellular respiration?",
    choices: ["CO₂ and water", "Glucose and oxygen", "ATP and ADP", "DNA and protein"],
    correct: 1,
    explain: "Glucose + oxygen go IN to cellular respiration." },

  { q: "What are the products of cellular respiration?",
    choices: ["Glucose and oxygen", "Carbon dioxide, water, and ATP", "DNA and RNA", "Proteins and lipids"],
    correct: 1,
    explain: "CO₂, H₂O, and ATP come OUT of cellular respiration." },

  { q: "What happens to energy stored in glucose?",
    choices: ["It is lost", "It is transferred into ATP", "It becomes DNA", "It is stored as fat"],
    correct: 1,
    explain: "The energy is transferred into ATP molecules (and some is lost as heat)." },

  { q: "Why are mitochondria called the powerhouse of the cell?",
    choices: ["They store DNA", "Because they make most of the cell's ATP", "They digest food", "They control the cell"],
    correct: 1,
    explain: "Mitochondria produce most of the cell's ATP — its 'power' supply." },

  { q: "What molecule carries electrons to the electron transport chain?",
    choices: ["ATP", "NADH", "Glucose", "Water"],
    correct: 1,
    explain: "NADH (and FADH₂) carry high-energy electrons to the ETC." },

  { q: "What happens to oxygen at the end of the electron transport chain?",
    choices: ["It is released", "It combines with electrons and hydrogen to form water", "It becomes CO₂", "It becomes glucose"],
    correct: 1,
    explain: "Oxygen accepts the final electrons + H⁺ → forms H₂O (water)." },

  { q: "Which process produces more ATP: fermentation or aerobic respiration?",
    choices: ["Fermentation", "Aerobic respiration", "They produce equal amounts", "Neither makes ATP"],
    correct: 1,
    explain: "Aerobic respiration makes ~32 ATP per glucose. Fermentation only makes 2." },

  { q: "What happens if a cell cannot make ATP?",
    choices: ["The cell grows faster", "The cell cannot function properly", "The cell turns into a virus", "The cell makes more DNA"],
    correct: 1,
    explain: "Without ATP, cells can't move, build, or maintain themselves — they die." },

  { q: "Why do living things need cellular respiration?",
    choices: ["To release energy from food for life processes", "To make food", "To grow tall", "To produce DNA"],
    correct: 0,
    explain: "Cellular respiration releases the chemical energy stored in food into usable ATP." }
];

// Bio-Codex entries — game elements + real science deep-dives
const CODEX = [
  { name: "Glucose (Player Lv 1)", body: "A sugar (C₆H₁₂O₆). Your starting form — the input to cellular respiration. Glucose is actually WHITE (like table sugar)." },
  { name: "Pyruvate (Player Lv 2)", body: "Glucose is split into 2 of these during glycolysis." },
  { name: "Acetyl-CoA (Player Lv 3)", body: "What pyruvate becomes — enters the Krebs cycle." },
  { name: "Electron (Player Lv 4)", body: "Flows through the ETC, helping make ATP." },
  { name: "Spikes", body: "Touching one kills your molecule." },
  { name: "Blocks", body: "Land on top, don't ram the side." },
  { name: "Yellow Orbs", body: "Press SPACE inside one for a mid-air jump." },
  { name: "Jump Pads", body: "Bounce you up higher than a normal jump." },
  { name: "ATP (score)", body: "Energy currency of the cell. Quiz answers and refunded death-questions add to your total." },
  { name: "🔥 Heat", body: "About 60% of glucose's energy is lost as HEAT, not ATP. This is why you feel warm — your mitochondria are tiny furnaces." },
  { name: "Where glucose comes from", body: "You eat carbs (bread, fruit, sugar). Digestion breaks them into glucose. Glucose enters your bloodstream and travels to every cell." },
  { name: "Fermentation (no oxygen)", body: "Without O₂, the ETC stops. Cells fall back on FERMENTATION: pyruvate becomes lactate (humans) or ethanol+CO₂ (yeast). Only 2 ATP." },
  { name: "Where ATP gets SPENT", body: "Muscle contraction, nerve impulses, building proteins, pumping ions, your brain (~20% of your daily ATP)." },
  { name: "Mitochondria's origin", body: "Endosymbiotic theory: mitochondria were once free-living bacteria! They still have their own DNA, inherited only from your mother." },
  { name: "The master equation", body: "C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + ~32 ATP + heat. Memorize this — it's THE biology equation." },
  { name: "Photosynthesis (the reverse)", body: "Plants run the OPPOSITE reaction: 6 CO₂ + 6 H₂O + sunlight → C₆H₁₂O₆ + 6 O₂. Plants make glucose, animals burn it." }
];
