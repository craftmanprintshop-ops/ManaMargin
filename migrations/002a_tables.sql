-- Migration 002a: Create lookup tables (known_sets, sc_set_codes, commander_deck_sets)
-- Run this FIRST in Supabase SQL Editor

ALTER TABLE offers ADD COLUMN IF NOT EXISTS is_sealed boolean DEFAULT true;

-- Known sets table
CREATE TABLE IF NOT EXISTS known_sets (
  set_name text PRIMARY KEY,
  set_type text,
  aliases text[] DEFAULT '{}'
);

INSERT INTO known_sets (set_name, set_type, aliases)
VALUES
  ('Teenage Mutant Ninja Turtles', 'expansion', '{"TMNT"}'),
  ('Marvel''s Spider-Man', 'expansion', '{"Marvel Spider-Man","Spider-Man","Marvel Super Heroes","Marvel Superheroes","MARVEL_SUPERHEROES","MSH"}'),
  ('Lorwyn Eclipsed', 'expansion', '{"Eclipsed"}'),
  ('Edge of Eternities', 'expansion', '{"SPACEOPERA","Space Opera"}'),
  ('Tarkir: Dragonstorm', 'expansion', '{"Tarkir Dragonstorm","Tarkir - Dragonstorm"}'),
  ('Avatar: The Last Airbender', 'expansion', '{"Avatar the Last Airbender","Avatar The Last Airbender","ATLA","Avatar Last Airbender","The Last Airbender"}'),
  ('Final Fantasy', 'expansion', '{"FINALFANTASY"}'),
  ('Aetherdrift', 'expansion', '{"DEATHRACE"}'),
  ('Innistrad Remastered', 'masters', '{}'),
  ('Foundations', 'core', '{"FND"}'),
  ('Duskmourn: House of Horror', 'expansion', '{"Duskmourn","DMHH"}'),
  ('Bloomburrow', 'expansion', '{"BLB"}'),
  ('Assassin''s Creed', 'draft_innovation', '{}'),
  ('Modern Horizons 3', 'draft_innovation', '{"MH3","MHT"}'),
  ('Outlaws of Thunder Junction', 'expansion', '{"OTJ"}'),
  ('Murders at Karlov Manor', 'expansion', '{}'),
  ('The Lost Caverns of Ixalan', 'expansion', '{"Lost Caverns of Ixalan","TLCOI"}'),
  ('Wilds of Eldraine', 'expansion', '{}'),
  ('The Lord of the Rings: Tales of Middle-earth', 'draft_innovation', '{"LOTR","Lord of the Rings","Lord of the Rings Tales of Middle-Earth","Tales of Middle-Earth","Tales of Middle-earth","The Lord of the Rings - Tales of Middle-Earth","The Lord of the Rings Tales of Middle-Earth"}'),
  ('Commander Masters', 'masters', '{}'),
  ('March of the Machine', 'expansion', '{}'),
  ('Phyrexia: All Will Be One', 'expansion', '{"Phyrexia All Will Be One","Phyrexia - All Will Be One"}'),
  ('Dominaria United', 'expansion', '{}'),
  ('Streets of New Capenna', 'expansion', '{}'),
  ('Kamigawa: Neon Dynasty', 'expansion', '{"Kamigawa Neon Dynasty"}'),
  ('Innistrad: Midnight Hunt', 'expansion', '{"Innistrad Midnight Hunt"}'),
  ('Strixhaven: School of Mages', 'expansion', '{"STX","Strixhaven"}'),
  ('Zendikar Rising', 'expansion', '{}'),
  ('Theros Beyond Death', 'expansion', '{}'),
  ('Throne of Eldraine', 'expansion', '{}'),
  ('Ravnica Remastered', 'masters', '{}'),
  ('Dominaria Remastered', 'masters', '{}'),
  ('Jumpstart 2022', 'draft_innovation', '{}'),
  ('Jumpstart', 'draft_innovation', '{}'),
  ('Doctor Who', 'commander', '{"DRWHO","DOCTORWHO"}'),
  ('Warhammer 40,000', 'commander', '{}'),
  ('Fallout', 'commander', '{}'),
  ('Modern Horizons 2', 'draft_innovation', '{"MH2"}'),
  ('Unfinity', 'funny', '{}'),
  ('Commander 2017', 'commander', '{}'),
  ('Innistrad', 'expansion', '{}'),
  ('Modern Masters 2017', 'masters', '{}'),
  ('Beta', 'core', '{}'),
  ('Star Trek', 'expansion', '{"STARTREK"}'),
  ('Starter Commander Decks', 'commander', '{"Starter Commander Deck"}'),
  ('Commander Legends: Battle for Baldur''s Gate', 'draft_innovation', '{"Commander Legends D&D Battle for Baldur''s Gate","BBG"}'),
  ('Commander Legends', 'draft_innovation', '{}'),
  ('Secret Lair', 'secret_lair', '{}'),
  ('Gundam', 'other', '{}')
ON CONFLICT (set_name) DO UPDATE SET
  set_type = EXCLUDED.set_type,
  aliases = EXCLUDED.aliases;

-- Pull in existing classified set names
INSERT INTO known_sets (set_name, set_type)
SELECT DISTINCT o.set_name, o.set_type
FROM offers o
WHERE o.set_name IS NOT NULL
  AND o.set_name NOT IN (SELECT set_name FROM known_sets)
  AND o.set_name !~ '^\[' AND o.set_name NOT ILIKE '%drop series%' AND o.set_name NOT ILIKE '%secret lair%'
ON CONFLICT (set_name) DO NOTHING;

-- SC set code mapping
CREATE TABLE IF NOT EXISTS sc_set_codes (
  code text PRIMARY KEY,
  set_name text NOT NULL REFERENCES known_sets(set_name)
);

INSERT INTO sc_set_codes (code, set_name)
VALUES
  ('BLB', 'Bloomburrow'),
  ('DEATHRACE', 'Aetherdrift'),
  ('DMHH', 'Duskmourn: House of Horror'),
  ('DOCTORWHO', 'Doctor Who'),
  ('DRWHO', 'Doctor Who'),
  ('FINALFANTASY', 'Final Fantasy'),
  ('FND', 'Foundations'),
  ('MAR26', 'Lorwyn Eclipsed'),
  ('MHT', 'Modern Horizons 3'),
  ('MARVEL', 'Marvel''s Spider-Man'),
  ('MSH', 'Marvel''s Spider-Man'),
  ('OTJ', 'Outlaws of Thunder Junction'),
  ('RT_LORWYN', 'Lorwyn Eclipsed'),
  ('RT_TARKIR', 'Tarkir: Dragonstorm'),
  ('SPACEOPERA', 'Edge of Eternities'),
  ('STARTREK', 'Star Trek'),
  ('CCG_TLCOI', 'The Lost Caverns of Ixalan'),
  ('MTGAIB', 'Avatar: The Last Airbender'),
  ('BBG', 'Commander Legends: Battle for Baldur''s Gate'),
  ('STX', 'Strixhaven: School of Mages'),
  ('TH', 'Teenage Mutant Ninja Turtles')
ON CONFLICT (code) DO UPDATE SET set_name = EXCLUDED.set_name;

-- Commander deck name -> set mapping
CREATE TABLE IF NOT EXISTS commander_deck_sets (
  deck_name text PRIMARY KEY,
  set_name text NOT NULL REFERENCES known_sets(set_name)
);

INSERT INTO commander_deck_sets (deck_name, set_name)
VALUES
  ('animated army', 'Bloomburrow'),
  ('family matters', 'Bloomburrow'),
  ('peace offering', 'Bloomburrow'),
  ('squirreled away', 'Bloomburrow'),
  ('eternal might', 'Aetherdrift'),
  ('living energy', 'Aetherdrift'),
  ('counter intelligence', 'Edge of Eternities'),
  ('conter-intelligence', 'Edge of Eternities'),
  ('world shaper', 'Edge of Eternities'),
  ('counter blitz', 'Final Fantasy'),
  ('limit break', 'Final Fantasy'),
  ('revival trance', 'Final Fantasy'),
  ('death toll', 'Duskmourn: House of Horror'),
  ('jump scare', 'Duskmourn: House of Horror'),
  ('endless punishment', 'Duskmourn: House of Horror'),
  ('miracle worker', 'Duskmourn: House of Horror'),
  ('hail caesar', 'Fallout'),
  ('science', 'Fallout'),
  ('scrappy survivors', 'Fallout'),
  ('mutant menace', 'Fallout'),
  ('blast from the past', 'Doctor Who'),
  ('masters of evil', 'Doctor Who'),
  ('paradox power', 'Doctor Who'),
  ('timey-wimey', 'Doctor Who'),
  ('creative energy', 'Modern Horizons 3'),
  ('eldrazi incursion', 'Modern Horizons 3'),
  ('graveyard overdrive', 'Modern Horizons 3'),
  ('tricky terrain', 'Modern Horizons 3'),
  ('abzan armor', 'Tarkir: Dragonstorm'),
  ('jeskai striker', 'Tarkir: Dragonstorm'),
  ('mardu surge', 'Tarkir: Dragonstorm'),
  ('sultai arisen', 'Tarkir: Dragonstorm'),
  ('temur roar', 'Tarkir: Dragonstorm'),
  ('ahoy mateys', 'The Lost Caverns of Ixalan'),
  ('blood rites', 'The Lost Caverns of Ixalan'),
  ('explorers of the deep', 'The Lost Caverns of Ixalan'),
  ('arcane wizardry', 'Commander 2017')
ON CONFLICT (deck_name) DO UPDATE SET set_name = EXCLUDED.set_name;
