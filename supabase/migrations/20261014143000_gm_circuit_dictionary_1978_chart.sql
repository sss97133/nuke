-- RSI pass 4 on the harness model: the GM circuit dictionary completed from the 1978 C/K Circuit Tabulation chart, and
-- the residual named by it. Case ledger 13.12.2.
--
-- After pass 3 the K5 residual (live preview, read-only, 2026-10-14) had 23 GM circuits the build cites with no baseline
-- row keyed to them, and 5 of the 28 numbers the build cites (63, 70, 72, 101, 140) were not in gm_circuit_identification
-- (219 circuits from the 1973 light duty truck service manual, section 8C). The library holds a second primary source:
-- GM ST 352 78, the 1978 light duty truck wiring diagrams for C/K (reference_documents/wiring_diagram_booklets/
-- ST_352_78_CK_Wiring.pdf, local, not in git), whose Circuit Tabulation chart on pp. 8-11 lists 275 circuits by number,
-- colour and name. One model year from the K5's 1977; GM circuit numbers are one numbering across years.
--
-- The rows below are generated, not typed: docs/wiring/calc-data/gm_circuit_tabulation_78.py --sql parses the library's
-- text extraction of those pages (two columns, wrapped colours and names, OCR noise). 274 circuits read with a colour;
-- 813's colour is unreadable in the extraction ("\Pm!te") and is left out. Measured against the dictionary: 145 numbers in
-- both, colour and stripe agree on 139; 6 disagree (22, 67, 225, 231, 232, 234); 129 numbers are new.
--
-- This pass:
--   1. Inserts the 129 new circuits, citing chart page; names as read (OCR spelling kept).
--   2. Records the second source on the 145 shared numbers in notes: "agrees with" or "reads <colour>" (the 6 conflicts are
--      left standing in both sources; neither is corrected).
--   3. Describes the dictionary's columns.
--   4. v_harness_factory_residual gains the dictionary's colour and name per GM circuit; v_harness_coverage gains
--      "GM circuits the build cites, named in the circuit dictionary"; stack SH gains the dictionary as a need.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regclass('public.v_harness_factory_residual') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 3 (20261014133000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gm_circuit_identification WHERE source_document LIKE 'GM ST 352 78%') THEN
    RAISE EXCEPTION 'the 1978 chart is already loaded';
  END IF;
END $guard$;

CREATE TEMP TABLE chart78 (circuit_number integer PRIMARY KEY, wire_color text NOT NULL, wire_color_stripe text, circuit_name text NOT NULL, page integer NOT NULL) ON COMMIT DROP;
INSERT INTO chart78 VALUES
  (2, 'RED', NULL, 'Feed, Battery - Unfused', 8),
  (3, 'PNK', NULL, 'Feed, Ign. Sw. "On" & Crank" Controlled, Unfused', 8),
  (4, 'BRN', NULL, 'Ign. Sw. "Accsy & On" Controlled, Unfused', 8),
  (5, 'YEL', NULL, 'Neutral Safety Start Sw. or Start Relay Feed', 8),
  (6, 'PPL', NULL, 'Starter Solenoid Feed', 8),
  (7, 'YEL', NULL, 'Primary Ignition Resistance By-Pass', 8),
  (8, 'GRY', NULL, 'I nstrument and Panel Lights (Fused No. 44 Ci r.)', 8),
  (9, 'BRN', NULL, 'Tail, License, Park and Side Marker Lamp Feed', 8),
  (10, 'YEL', NULL, 'Di mmer Sw. Feed', 8),
  (11, 'LT GRN', NULL, 'Headlamp Feed, Hi-Beam', 8),
  (12, 'TAN', NULL, 'Headlamp Feed, Lo-Beam', 8),
  (13, 'PPL', NULL, 'Front Parking Lamps', 8),
  (14, 'LT BLU', NULL, 'L.H. Indicator and Front Directional Lamps', 8),
  (15, 'DK BLU', NULL, 'R.H. Indicator and Front Directional Lamps', 8),
  (16, 'PPL', NULL, 'Directional Signal Sw., Feed From Flasher', 8),
  (17, 'WHT', NULL, 'Directional Signal Sw., Feed From Stop Sw.', 8),
  (18, 'YEL', NULL, 'Stop and Directional Lamp or Directional Lamp Only Rear L.H.', 8),
  (19, 'DK GRN', NULL, 'Stop and Directional Lamp or Directional Lamp Only Rear R.H.', 8),
  (20, 'LT BLU', NULL, 'Stop Lamp (Only)', 8),
  (21, 'PNK', NULL, 'Spot Light', 8),
  (22, 'BLK', NULL, 'Direct Ground Trailer', 8),
  (24, 'LT GRN', NULL, 'Back Up Lamp Feed', 8),
  (25, 'BRN', NULL, 'Feed, Voltage Regulator Controlled', 8),
  (26, 'DK BLU', NULL, 'Field Circuit (F) (Gen/Reg.)', 8),
  (27, 'BRN', NULL, 'Traffic Hazard Sw., Feed from Hazard Flasher', 8),
  (28, 'BLK', NULL, 'Ground, Horn Sw. Controlled', 8),
  (29, 'DK GRN', NULL, 'Horn Feed', 8),
  (30, 'PNK', NULL, 'Fuel Gauge to Tank Unit', 8),
  (31, 'TAN', NULL, 'Oil Pressure, Engine', 8),
  (32, 'YEL', NULL, 'Map Light Feed', 8),
  (33, 'TAN', 'WHT', 'Warning Light - Brake', 8),
  (34, 'PPL', NULL, 'Fog or Drive Lamp', 8),
  (35, 'DK GRN', NULL, 'Ground, Eng. Coolant Temp. Sw. Controlled (Hot)', 8),
  (36, 'LT GRN', NULL, 'Ground, Eng. Temp. Sw. Controlled (Cold)', 8),
  (37, 'LT GRN', NULL, 'Ground, Eng. Metal Temp. Sw. Controlled (Hot)', 8),
  (38, 'DK BLU', NULL, 'Flasher Fused Feed i', 8),
  (39, 'PNK', 'BLK', 'Feed, Ign. Sw. "On and Crank" Controlled - Fused', 8),
  (40, 'ORN', NULL, 'Feed, Battery - Fused', 8),
  (41, 'BRN', 'WHT', 'Fee, Ign. Sw. "Accsy and On" Controlled Fused', 8),
  (42, 'YEL', NULL, 'Feed, AIC Auto Relay Controlled', 8),
  (43, 'YEL', NULL, 'Radio Feed', 8),
  (44, 'DK GRN', NULL, 'I.P. and Lights Feed (Usually light Sw. to Fuse)', 8),
  (45, 'BLK', NULL, 'Marker and Clearance Lamps (Trailers)', 8),
  (46, 'DK BLU', NULL, 'Rear Seat Speaker Feed from Single Radio or Right Stereo', 8),
  (47, 'DK BLU', NULL, 'Auxiliary Circuit (Trailer)', 8),
  (50, 'BRN', NULL, 'Feed, Ign. Sw. "On" Controlled Fused', 8),
  (51, 'YEL', NULL, 'Blower Resistor Feed Low', 8),
  (52, 'ORN', NULL, 'Feed, Blow Sw. "Hi" or Selectro Sw. "Max Cold" Controlled', 8),
  (53, 'LT GRN', NULL, 'Valve Release Solenoid to Control Box', 8),
  (54, 'DK GRN', NULL, 'Control to Shield', 8),
  (55, 'ORN', NULL, 'Kick Down Solenoid Feed', 8),
  (56, 'TAN', NULL, 'Amplifier to Transducer', 8),
  (57, 'ORN', NULL, 'L.H. Cornering Lamp Feed', 8),
  (58, 'BLK', NULL, 'R.H. Cornering Lamp Feed', 8),
  (59, 'DK GRN', NULL, 'Compressor Feed', 8),
  (60, 'ORN', 'BLK', 'Feed, Battery, Circuit Breaker Protected', 8),
  (61, 'YEL', NULL, 'Ground, Resistive, Auto AIC Amb. Sensor Controlled', 8),
  (62, 'LT GRN', NULL, 'Ground, Resistive, Auto AIC Feed Back Pot Controlled', 8),
  (63, 'TAN', NULL, 'Feed, Blower Sw. "Medium 1" Controlled', 8),
  (64, 'BRN', NULL, 'Blower Sw. Feed from AIC Selector Sw.', 8),
  (65, 'PPL', NULL, 'Blower Motor Feed', 8),
  (66, 'LT GRN', NULL, 'Feed, A/C Selector Sw. Controlled (Comp. Ct.)', 8),
  (67, 'BLU', NULL, 'Feed, AIC Freon Press, Cut- Out Sw. Controlled', 8),
  (68, 'YEL', 'BLK', 'Ground, Resistive, Low Cooland Probe Controlled', 8),
  (69, 'GRY', NULL, 'Ground Low Coolant Module Controlled', 8),
  (70, 'PNK', NULL, 'Feed, Relay Controlled, Ign. Sw. Controlled', 8),
  (71, 'BLK', NULL, 'Ground, AIC Selector Sw. "Def" Controlled', 8),
  (72, 'LT BLU', NULL, 'Feed, Blower Sw. "Medium i'' Controlled', 8),
  (73, 'PPL', 'WHT', 'Feed, Blower Sw. "Medium 3" Controlled', 8),
  (74, 'LT GRN', NULL, 'Feed to Throttle Switch', 9),
  (75, 'DK BLU', NULL, 'Feed, Ign. Sw. "On and Crank" Controlled - Fused', 9),
  (76, 'PNK', NULL, 'Feed, Ign. Sw. Controlled', 9),
  (78, 'LT BLU', NULL, 'Electric Choke Feed', 9),
  (80, 'LT GRN', NULL, 'Ground Key Warning Buzzer', 9),
  (83, 'DK GRN', NULL, 'Feed, Cruise Engage Sw. "Retard" Controlled', 9),
  (84, 'DK BLU', NULL, 'Feed, Cruise Engage Sw. "Engage II Controlled', 9),
  (85, 'WHT', NULL, 'Ground, Cruise Indicator Regulator Controlled', 9),
  (86, 'BRN', NULL, 'Feed, Cruise Brake Release Sw. Controlled', 9),
  (90, 'PNK', NULL, 'Feed, Cutout Sw. Controlled. Cir. Brkr. Protected', 9),
  (91, 'GRY', NULL, 'Windshield Wiper - Low', 9),
  (92, 'PPL', NULL, 'Windshield Wiper - Hi', 9),
  (93, 'WHT', NULL, 'Windshield Wiper Motor Feed', 9),
  (94, 'PNK', NULL, 'Windshield Washer Sw. to Washer', 9),
  (95, 'DK GRN', NULL, 'Ground, Pulse Wiper Sw. Controlled', 9),
  (96, 'BRN', NULL, 'Feed, Pulse Wiper Rheostat Sw. Controlled', 9),
  (99, 'BLK', 'WHT', 'Windshield Washer Low Fluid', 9),
  (101, 'DK BLU', NULL, 'Resistor Output to Blower Relay', 9),
  (102, 'WHT', NULL, 'Sl Alternator Regulator Sensi ng Circuit', 9),
  (105, 'BLK', NULL, 'Ammeter - Generator', 9),
  (106, 'GRY', NULL, 'Ammeter - Battery', 9),
  (107, 'DK BLU', NULL, 'Over Speed Warning Light', 9),
  (111, 'BLK', NULL, 'Ground, Anti-Ski Low Air Sw. Controlled', 9),
  (112, 'DK GRN', NULL, 'Telltale Temperature Gauge (Hot)', 9),
  (115, 'LT BLU', NULL, 'Speaker Return, RT rr Stereo', 9),
  (116, 'YEL', NULL, 'Speaker Return, LF rr Stereo', 9),
  (117, 'DK GRN', NULL, 'Speaker Return, RT Frt. Stereo', 9),
  (118, 'GRY', NULL, 'Speaker Return, LF Frt. Stereo', 9),
  (119, 'WHT', NULL, 'Generator (Alternator) to Regulator', 9),
  (120, 'PPL', NULL, 'Electric Fuel Pump Feed', 9),
  (121, 'WHT', NULL, 'Tachometer to Coil', 9),
  (125, 'YEL', NULL, 'Door Jamb Switch', 9),
  (126, 'BLK', NULL, 'Seat Back Lock Feed', 9),
  (130, 'BRN', 'WHT', 'Generator (Alternator) Ext. Resist. 2 Ohms/Foot', 9),
  (131, 'BLK', 'PNK', 'Generator (Alternator) Ext. Resist. 1 Ohm/Foot', 9),
  (132, 'WHT', NULL, 'Ground, Fuel Economy Sw. Controlled. Amber Telltale', 9),
  (133, 'YEL', NULL, 'Ground, Fuel Economy Sw. Controlled, Grn. Telltale', 9),
  (135, 'DK GRN', 'WHT', 'Ground, Resistive, Temp. Gauge Sender Controlled', 9),
  (139, 'PNK', 'BLK', 'Feed, Ign. Sw. "On and Crank" Controlled Fused', 9),
  (140, 'ORN', NULL, 'Feed. Battery - Fused', 9),
  (141, 'BRN', 'WHT', 'Ign. Sw .. "Accsy and On" Controlled', 9),
  (142, 'BLK', NULL, 'Rr Compartment Lid Lock Release', 9),
  (143, 'PNK', NULL, 'Feed Radio Sw. "On" Controlled', 9),
  (144, 'YEL', NULL, 'Feed to Pwr Ant Sw.', 9),
  (145, 'DK GRN', NULL, 'Feed, Pwr Ant Up, Relay Controlled', 9),
  (150, 'BLK', NULL, 'Ground Circuit - Direct', 9),
  (151, 'BLK', NULL, 'Ground Circuit - Direct', 9),
  (152, 'BLK', NULL, 'Ground Circuit Direct', 9),
  (153, 'BLK', NULL, 'Ground Circuit Direct', 9),
  (154, 'BLK', NULL, 'Ground Circuit - Direct', 9),
  (155, 'BLK', NULL, 'Ground Circuit - Direct', 9),
  (156, 'WHT', NULL, 'Ground Circuit - Sw. Controlled Body Interior Lamps such as Dome, Courtesy, Map Warning. etc.', 9),
  (157, 'GRY', NULL, 'Ground Circuit - Sw. Controlled - Body Interior Lamps - such as Dome, Courtesy. Map, Warning etc.', 9),
  (158, 'BLK', 'ORN', 'Ground Circuit - Sw. Controlled Body Interior Lamps - such as Dome, Courtesy, Map, Warning etc.', 9),
  (159, 'TAN', NULL, 'Ground, Key Warning Buzzer', 9),
  (160, 'WHT', NULL, 'Power Antenna Down', 9),
  (161, 'BLK', NULL, 'Power Antenna Up', 9),
  (162, 'GRY', NULL, 'Power Top Up', 9),
  (163, 'PPL', NULL, 'Power Top Down', 9),
  (164, 'DK BLU', NULL, 'Window Control LF Up', 9),
  (165, 'BRN', NULL, 'Window Control LF Down', 9),
  (166, 'DK BLU', 'WHT', 'Window Control R F Up', 9),
  (167, 'TAN', NULL, 'Window Control RF Down', 9),
  (168, 'DK GRN', NULL, 'Window Control LR Up', 9),
  (169, 'PPL', NULL, 'Window Control LR Down', 9),
  (170, 'LT GRN', NULL, 'Window Control RR Up', 9),
  (171, 'PPL', 'WHT', 'Window Control RR Down', 9),
  (172, 'LT GRN', NULL, 'Vent Control LF Close', 9),
  (173, 'YEL', NULL, 'Vent Control LF Open', 9),
  (174, 'DK GRN', NULL, 'Vent Control RF Close', 9),
  (175, 'PPL', NULL, 'Vent Control R F Open', 9),
  (176, 'DK GRN', NULL, 'Power Seat Fore', 9),
  (177, 'YEL', NULL, 'Power Seat Aft or Reel ine', 9),
  (178, 'DK GRN', NULL, 'Power Seat - 6-Way Fore and Aft', 9),
  (179, 'TAN', NULL, 'Power Seat - 6-Way Solenoid - Rear - Up and Down', 9),
  (180, 'LT GRN', NULL, 'Power Seat - 6-Way Solenoid Front Up and Down', 9),
  (181, 'LT BLU', NULL, 'Power - Solenoid - Fore and Aft', 10),
  (182, 'YEL', NULL, 'Power Seat - 6-Way - Aft and Down', 10),
  (183, 'LT BLU', NULL, 'Tailgate or Center Partition Window Up', 10),
  (184, 'TAN', 'WHT', 'Tailgate or Center Partition Window Down', 10),
  (185, 'TAN', NULL, 'Vent Control LR Open', 10),
  (186, 'GRY', NULL, 'Vent Control LR Close', 10),
  (187, 'DK BLU', NULL, 'Vent Control RR Open', 10),
  (188, 'LT BLU', NULL, 'Vent Control RR Close', 10),
  (189, 'DK GRN', NULL, 'Power Seat - 4-Way - Fore and Down', 10),
  (190, 'YEL', NULL, 'Power Seat 4-Way - Aft and Up', 10),
  (191, 'LT GRN', NULL, 'Power Seat 4-Way Solenoid Up and Down', 10),
  (192, 'PPL', NULL, 'Defogger - Hi or Single Speed', 10),
  (193, 'PPL', 'WHT', 'Defogger - Low Speed - 0.38 Ohms per foot', 10),
  (194, 'BLK', NULL, 'Electric Door Lock - Unlock', 10),
  (195, 'LT BLU', NULL, 'Electric Door Lock - Lock', 10),
  (198, 'LT GRN', 'BLK', 'Ground, Resistive, AIC In-Car Sensor Controlled', 10),
  (199, 'BRN', NULL, 'Rear Seat Speaker Feed from Radio Left Stereo', 10),
  (200, 'LT GRN', NULL, 'Front Speaker Feed From Radio Single or Right Stereo', 10),
  (201, 'TAN', NULL, 'Front Speaker - Feed from Radio - Left Stereo', 10),
  (202, 'BLK', NULL, 'Ground, Compressor over Heat Sw. Controlled', 10),
  (203, 'LT BLU', NULL, 'Rear AIC Potentiometer Feed', 10),
  (204, 'DK BLU', NULL, 'Thermal Limiter Feed', 10),
  (205, 'WHT', 'BLK', 'Seat Belt Seat Sensor to Belt Retractor (Grd)', 10),
  (206, 'DK BLU', NULL, 'Neutral Start Sw. to Buzzer and Lamp', 10),
  (207, 'YEL', NULL, 'Seat Sensor to Neutral Start Sw. (Lamp and Buzzer Grd)', 10),
  (208, 'GRY', NULL, 'Sw. Controlled Ground (TCS)', 10),
  (209, 'PPL', NULL, 'Park Brake Warning Lamp', 10),
  (210, 'WHT', NULL, 'Power Seat - 6-Way - Fore and Down - "A" Body', 10),
  (211, 'DK BLU', NULL, 'Power Seat - 6-Way Aft and Up - "A" Body', 10),
  (212, 'YEL', 'BLK', 'LH Seat Sensor', 10),
  (213, 'DK BLU', NULL, 'Center Seat Sensor', 10),
  (214, 'GRY', NULL, 'RH Seat Sensor', 10),
  (215, 'TAN', 'BLK', 'LH Sw.', 10),
  (216, 'DK BLU', 'WHT', 'Center Buckle Sw. (Feed)', 10),
  (217, 'GRY', 'WHT', 'RH Sw.', 10),
  (218, 'DK GRN', NULL, 'Interlock Relay - Ground (Provided by Electronics)', 10),
  (219, 'LT GRN', 'BLK', 'Starter Interlock Controlled Starter Feed', 10),
  (220, 'YEL', NULL, 'Starter Interlock Buz and Lp Feed', 10),
  (221, 'BRN', NULL, 'Lo Level Actuation Passenger System', 10),
  (222, 'DK BLU', NULL, 'Common Return Hi & Lo Fire Circu i ts Passenger', 10),
  (223, 'LT BLU', NULL, 'Bumper Sw. Actuation', 10),
  (224, 'LT GRN', NULL, 'Lo Pressure Warning', 10),
  (225, 'PPL', NULL, 'Warning Lamp Ground', 10),
  (226, 'ORN', NULL, 'Warning Lamp Sensor', 10),
  (227, 'TAN', NULL, 'Recorder to Sensor Power Feed', 10),
  (228, 'YEL', NULL, 'Warning Lamp Feed', 10),
  (229, 'PNK', NULL, 'Sensor & Bumper Sw_ Power Feed', 10),
  (230, 'PNK', NULL, 'Recorder Power Feed', 10),
  (231, 'LT BLU', NULL, 'Driver Low Level Actuation', 10),
  (232, 'DK BLU', NULL, 'Driver Return', 10),
  (233, 'DK GRN', NULL, 'Hi Level Actuation Passenger', 10),
  (234, 'TAN', NULL, 'Ign. Sw. Cont Air Rest Feed', 10),
  (237, 'YEL', NULL, 'Feed, Belt Warn Timer Controlled (Timed 39 Ct.)', 10),
  (238, 'BLK', NULL, 'Seat Belt Warn System-Buzzer Ground to Belt Assy Sw. """.', 10),
  (239, 'PNK', 'BLK', 'Feed, Ign. Sw. "On & Crank" Controlled Fused', 10),
  (240, 'ORN', NULL, 'Feed, Battery Fused', 10),
  (242, 'TAN', NULL, 'Feed, Throttle Control Spark Valve Controlled', 10),
  (243, 'BLK', 'WHT', 'Feed, Drive Selector Sw. Controlled', 10),
  (244, 'PPL', NULL, 'Feed, L T F /0 Solenoid Relay Controlled', 10),
  (245, 'DK BLU', NULL, 'Feed, RT FID Solenoid Relay Controlled', 10),
  (246, 'DK GRN', NULL, 'Feed, AD L Lock Relay Coil', 10),
  (247, 'BRN', NULL, 'Feed, to AIC Shut-Off Relay', 10),
  (248, 'DK BLU', NULL, 'Feed, to AIC Compressor Harn Relay Controlled', 10),
  (249, 'DK GRN', NULL, 'Feed, From AIC Harn', 10),
  (252, 'YEL', NULL, 'Ground, ADL Module Unlock Output Controlled', 10),
  (253, 'DK BRN', NULL, 'Ground, ADL Module Lock Output Controlled', 10),
  (254, 'LT GRN', NULL, 'Ground, ADL L T Unlock Relay Coil', 10),
  (255, 'YEL', NULL, 'Ground, AD L RT Unlock Relay Coil', 10),
  (256, 'DK BLU', NULL, 'Ground, Module Controlled, Lamp Out Indicator', 10),
  (257, 'BRN', NULL, 'Ground, AIC Press, Sw. Controlled ".."', 10),
  (260, 'BLK', NULL, 'Theft Deterrent Hood Sw.', 10),
  (261, 'YEL', NULL, 'I Theft Deterrent Alarm Arm i', 10),
  (262, 'LT GRN', NULL, 'Theft Deterrent Key - Door Unlock and Alarm Disarm', 11),
  (263, 'LT BLU', NULL, 'Theft Deterrent Alarm', 11),
  (264, 'DK GRN', NULL, 'Theft Deterrent Arm Indication', 11),
  (265, 'BLK', 'WHT', 'Theft Deterrent - Alarm Output', 11),
  (266, 'PNK', NULL, 'Theft Deterrent - Alarm Arm Abort', 11),
  (267, 'DK GRN', NULL, 'PWr Seat Fore and Up Reel iner', 11),
  (268, 'YEL', NULL, 'Pwr Seat - Aft and Down Recliner', 11),
  (269, 'LT GRN', NULL, 'Pwr Seat - Sol Up and Down Recliner', 11),
  (270, 'BLK', 'YEL', 'Feed, Ampl ifier to Potentiometer', 11),
  (271, 'PPL', NULL, 'Ground, Potentiometer Controlled', 11),
  (272, 'LT GRN', NULL, 'Feed, Potentiometer Rheostat Controlled', 11),
  (273, 'YEL', NULL, 'Feed, Hdlp Sw. to Amplifier, Hdlp Sw. Controlled', 11),
  (274, 'DK GRN', 'WHT', 'Feed, Hdlp Sw. to Amplifier', 11),
  (275, 'LT GRN', NULL, 'Feed, Neut Saf Start Sw. "Park" Controlled', 11),
  (276, 'LT GRN', NULL, 'Reel. Mtr. Feed, Power St. Fwd.', 11),
  (277, 'LT BLU', NULL, 'Reel. Mtr. Feed, Power St. Recliner', 11),
  (278, 'DK GRN', NULL, 'Amplifier to Photocell', 11),
  (280, 'PNK', NULL, 'Feed, P.M. Motor Up Cycle (Deck Lid Pull Down)', 11),
  (281, 'WHT', NULL, 'Ground, Relay Coil Down Cycle (Deck Lid Pull Down)', 11),
  (291, 'DK BLU', NULL, 'Ground, Heated Glass Timer, On-Off Sw. Controlled', 11),
  (292, 'LT BLU', NULL, 'Feed, Heated Glass Timer, On-Off Sw. Controlled', 11),
  (293, 'PPL', 'WHT', 'Feed, Heated Glass Timer Controlled', 11),
  (294, 'TAN', NULL, 'Door Lock Motor Unlock', 11),
  (295, 'GRY', NULL, 'Door Lock Motor - Lock', 11),
  (300, 'ORN', NULL, 'Feed, Ign. Sw., "On" Con- . trolled Unfused', 11),
  (339, 'PNK', 'BLK', 'Feed, Ign. Sw. On and Crank Controlled Fused', 11),
  (340, 'ORN', NULL, 'Feed, Battery Fused', 11),
  (350, 'PNK', 'WHT', 'Feed, Ign. Sw. "On" Controlled - Fused', 11),
  (394, 'LT GRN', 'BLK', 'Ground, L T FlO Remote Handle Sw. Controlled', 11),
  (395, 'LT BLU', NULL, 'Ground, RT FlO Remote Handle Sw. Controlled', 11),
  (402, 'LT GRN', NULL, 'Feed, Electronic Cruise Control Valve', 11),
  (439, 'PNK', 'BLK', 'Feed Ign. Sw. "On & Crank" Controlled - Fused', 11),
  (440, 'ORN', NULL, 'Feed, Battery - Fused', 11),
  (618, 'YEL', 'BLK', 'Feed, L T Side Trailer and Direction', 11),
  (619, 'GRN', 'WHT', 'Feed, RT Side Trailer and Direction', 11),
  (756, 'DK GRN', 'WHT', 'Feed, Vac Sol Controlled (For Electronic Distributor)', 11),
  (801, 'BRN', NULL, 'Feed, EF I Battery Controlled, Fusible Link Protected', 11),
  (804, 'PPL', NULL, 'EFI, Ign. Sw. "Crank" Controlled, Fusible Link Protected', 11),
  (807, 'PPL', NULL, 'Feed, EFI Battery Controlled, Fused', 11),
  (808, 'DK BLU', NULL, 'Feed, Er-I Module Fast Idle Valve Output and 3 Circuit Controlled'' - Fused', 11),
  (810, 'TAN', NULL, 'Feed, Distributor Electronics Controlled', 11),
  (811, 'WHT', NULL, 'I eed, EFI Module Group Two I njector Output Controlled Fusible Link Protected', 11),
  (812, 'PNK', NULL, 'Feed, EFI Module Group One Injector Output Controlled Fusible Link Protected', 11),
  (814, 'YEL', NULL, 'Feed, EFI Distributor Trigger and 815 Circuit Controlled, Fused', 11),
  (815, 'BLK', NULL, 'Feed, EFI Module Distributor Trigger Output Controlled, Fused', 11),
  (816, 'PNK', NULL, 'Accelerator Enrichment Input #2', 11),
  (817, 'TAN', NULL, 'Accelerator Enrichment Input #1', 11),
  (818, 'LT GRN', NULL, 'Accelerator Enrichment Sw. Supply Voltage', 11),
  (819, 'BLK', 'WHT', 'Clossed Throttle Sw.', 11),
  (820, 'ORN', NULL, 'Wide Open Throttle Switch', 11),
  (821, 'DK GRN', NULL, 'Ground, EFI Module Coolant Temp. Sensor Output Controlled', 11),
  (822, 'DK BLU', NULL, 'Ground, Resistive, Coolant Temp. Sensor Controlled', 11),
  (823, 'GRY', NULL, 'Ground, EFI Module Air Temp. Sensor Output Controlled', 11),
  (824, 'ORN', NULL, 'Ground, Resistive, Air Temp. Sensor Controlled', 11),
  (827, 'DK GRN', NULL, 'Feed, EFI Module Elec Fuel Pump Output Controlled - Fused', 11),
  (828, 'GRY', NULL, 'Feed, EFI, Ign. Sw. "On & Crank" Controlled, Fused', 11),
  (831, 'BRN', NULL, 'Feed, EFI Module EGR Solenoid Output Controlled, Fused', 11)
;

-- 1. New circuits.
INSERT INTO public.gm_circuit_identification (circuit_number, wire_color, wire_color_stripe, circuit_name, source_document, notes)
SELECT c.circuit_number, c.wire_color, c.wire_color_stripe, c.circuit_name,
       'GM ST 352 78, 1978 Light Duty Truck Wiring Diagrams (C/K), Circuit Tabulation p.' || c.page,
       'transcribed from the library text extraction of the chart (gm_circuit_tabulation_78.py); name spelling as read'
FROM chart78 c
WHERE NOT EXISTS (SELECT 1 FROM public.gm_circuit_identification g WHERE g.circuit_number = c.circuit_number);

-- 2. The second source on shared numbers.
UPDATE public.gm_circuit_identification g
SET notes = concat_ws('; ', g.notes,
  CASE WHEN (c.wire_color, c.wire_color_stripe) IS NOT DISTINCT FROM (g.wire_color, g.wire_color_stripe)
       THEN 'colour agrees with GM ST 352 78 (1978 C/K) Circuit Tabulation p.' || c.page
       ELSE 'GM ST 352 78 (1978 C/K) Circuit Tabulation p.' || c.page || ' reads ' || c.wire_color || coalesce('/' || c.wire_color_stripe, '') || ' (conflict, not resolved)' END)
FROM chart78 c
WHERE c.circuit_number = g.circuit_number AND g.source_document NOT LIKE 'GM ST 352 78%';

-- 3. The dictionary, described.
COMMENT ON TABLE public.gm_circuit_identification IS 'Dimension: the GM circuit identification numbering (number, insulation colour and stripe, name), one row per number. Rows cite their source page (1973 light duty truck service manual section 8C; 1978 C/K wiring diagram booklet Circuit Tabulation since RSI pass 4). Factory baselines and build wire ends key to circuit_number.';
COMMENT ON COLUMN public.gm_circuit_identification.id IS 'Row key.';
COMMENT ON COLUMN public.gm_circuit_identification.circuit_number IS 'GM circuit identification number; unique.';
COMMENT ON COLUMN public.gm_circuit_identification.wire_color IS 'Insulation base colour, GM abbreviation (BRN, LT GRN).';
COMMENT ON COLUMN public.gm_circuit_identification.wire_color_stripe IS 'Stripe colour of a two-tone wire; null for a solid colour.';
COMMENT ON COLUMN public.gm_circuit_identification.circuit_name IS 'The circuit''s name as the source prints it.';
COMMENT ON COLUMN public.gm_circuit_identification.source_document IS 'The document and page the row was transcribed from.';
COMMENT ON COLUMN public.gm_circuit_identification.notes IS 'Other sources on the same number: agreement, or a conflicting reading left unresolved.';
COMMENT ON COLUMN public.gm_circuit_identification.created_at IS 'When the row was written.';

-- 4. The residual and the scoreboard name circuits by the dictionary.
CREATE OR REPLACE VIEW public.v_harness_factory_residual AS
WITH veh AS (
  SELECT o.vehicle_id, o.factory_generation, v.year
  FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE v.is_public IS TRUE AND o.factory_generation IS NOT NULL AND v.year IS NOT NULL),
base AS (
  SELECT veh.vehicle_id, f.gm_circuit_number AS gm, array_agg(f.circuit_code ORDER BY f.circuit_code) AS factory_codes
  FROM veh JOIN public.factory_harness_circuits f ON f.generation = veh.factory_generation AND f.year_range @> veh.year
  WHERE f.gm_circuit_number IS NOT NULL
  GROUP BY 1, 2),
cite AS (
  SELECT h.vehicle_id, n.gm::int AS gm, h.row_id AS termination_id
  FROM public.harness_evidence h
  JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(o.structured_data->'gm_circuits', '[]'::jsonb)) n(gm)
  WHERE h.row_kind = 'termination' AND o.structured_data->>'property_key' = 'factory circuit'
    AND h.vehicle_id IN (SELECT vehicle_id FROM veh)),
cited AS (
  SELECT c.vehicle_id, c.gm, count(DISTINCT c.termination_id) AS wire_ends, count(DISTINCT s.net_id) AS nets
  FROM cite c
  LEFT JOIN public.harness_segments s ON NOT s.is_superseded AND c.termination_id IN (s.from_termination_id, s.to_termination_id)
  GROUP BY 1, 2)
SELECT coalesce(b.vehicle_id, c.vehicle_id) AS vehicle_id, coalesce(b.gm, c.gm) AS gm_circuit_number, b.factory_codes,
  CASE WHEN b.gm IS NOT NULL AND c.gm IS NOT NULL THEN 'carried' WHEN b.gm IS NOT NULL THEN 'unassessed' ELSE 'baseline gap' END AS status,
  coalesce(c.wire_ends, 0) AS wire_ends, coalesce(c.nets, 0) AS nets,
  g.wire_color AS gm_wire_color, g.wire_color_stripe AS gm_wire_stripe, g.circuit_name AS gm_circuit_name
FROM base b FULL JOIN cited c ON c.vehicle_id = b.vehicle_id AND c.gm = b.gm
LEFT JOIN public.gm_circuit_identification g ON g.circuit_number = coalesce(b.gm, c.gm);

CREATE OR REPLACE VIEW public.v_harness_coverage AS
WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
             WHERE NOT s.is_superseded AND v.is_public IS TRUE),
ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
         WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
           AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
         WHERE NOT n.is_superseded AND v.is_public IS TRUE),
base AS (SELECT o.vehicle_id, f.* FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
         JOIN public.factory_harness_circuits f ON f.generation = o.factory_generation AND f.year_range @> v.year
         WHERE v.is_public IS TRUE),
res AS (SELECT * FROM public.v_harness_factory_residual)
SELECT vehicle_id, 'fold' AS layer, 'segments decided' AS measure, count(*) FILTER (WHERE design_status = 'decided') AS numerator, count(*) AS denominator FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'segments with both ends known', count(*) FILTER (WHERE from_termination_id IS NOT NULL AND to_termination_id IS NOT NULL), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'segments keyed to a wire part', count(wire_part_id), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'prediction', 'segments with a planned length', count(planned_length_ft), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'outcome', 'segments measured as cut', count(measured_length_ft), count(*) FROM seg GROUP BY 1
UNION ALL SELECT s.vehicle_id, 'key', 'segments carrying an option link', count(DISTINCT l.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.wiring_decision_links l ON l.segment_id = s.id GROUP BY 1
UNION ALL SELECT s.vehicle_id, 'dimension', 'segments routed over topology', count(DISTINCT r.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.harness_routings r ON r.segment_id = s.id AND NOT r.is_superseded GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a cavity', count(cavity_layout_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a terminal part', count(terminal_contact_catalog_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a crimp tool', count(crimp_tool_catalog_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT e.vehicle_id, 'log', 'wire ends with cited evidence', count(DISTINCT h.row_id) FILTER (WHERE h.relation = 'supports'), count(DISTINCT e.id) FROM ends e LEFT JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id = e.id GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'nets with protection', count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL OR protection_fuse_part_id IS NOT NULL), count(*) FROM nets GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1
UNION ALL SELECT vehicle_id, 'baseline', 'factory circuits keyed to a GM circuit number', count(gm_circuit_number), count(*) FROM base GROUP BY 1
UNION ALL SELECT vehicle_id, 'residual', 'factory GM circuits carried by the build', count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status <> 'baseline gap') FROM res GROUP BY 1
UNION ALL SELECT vehicle_id, 'residual', 'GM circuits the build cites that the baseline cannot key', count(*) FILTER (WHERE status = 'baseline gap'), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
UNION ALL SELECT n.vehicle_id, 'residual', 'nets carrying a factory circuit', count(DISTINCT n.id) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.harness_segments s JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id IN (s.from_termination_id, s.to_termination_id)
           JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
           WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1
UNION ALL SELECT vehicle_id, 'dimension', 'GM circuits the build cites, named in the circuit dictionary', count(*) FILTER (WHERE status <> 'unassessed' AND gm_circuit_name IS NOT NULL), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1;
GRANT SELECT ON public.v_harness_factory_residual TO anon, authenticated, service_role;
GRANT SELECT ON public.v_harness_coverage TO anon, authenticated, service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'table', 'gm_circuit_identification', NULL, 'the GM circuit dictionary the factory baseline and the build key to');

-- 5. The dimensions the harness keys point at, readable by a logged-out reader. Measured 2026-10-14: row security on
--    with no policy at all on connector_cavity_layouts, pdm_units and pdm_channels, so a public reader resolves 0 of the
--    295 cavity keys and 0 of the 57 protection keys. The cavity library is reference data (no vehicle, no private
--    data): public read, like catalog_parts and gm_circuit_identification. PDM units and channels belong to a vehicle:
--    readable when the vehicle is public or the reader owns it, the harness tables' rule.
CREATE POLICY "Public read" ON public.connector_cavity_layouts FOR SELECT USING (true);
CREATE POLICY "Public read for public vehicles" ON public.pdm_units FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = pdm_units.vehicle_id AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
CREATE POLICY "Public read for public vehicles" ON public.pdm_channels FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.pdm_units u JOIN public.vehicles v ON v.id = u.vehicle_id
  WHERE u.id = pdm_channels.pdm_unit_id AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));

-- Result.
DO $check$
DECLARE added int; agree int; conflict int; named int; cited int;
BEGIN
  SELECT count(*) INTO added FROM public.gm_circuit_identification WHERE source_document LIKE 'GM ST 352 78%';
  SELECT count(*) FILTER (WHERE notes LIKE '%colour agrees with GM ST 352 78%'), count(*) FILTER (WHERE notes LIKE '%(conflict, not resolved)%')
    INTO agree, conflict FROM public.gm_circuit_identification;
  SELECT coalesce(sum(numerator), 0), coalesce(sum(denominator), 0) INTO named, cited FROM public.v_harness_coverage
  WHERE measure = 'GM circuits the build cites, named in the circuit dictionary';
  RAISE NOTICE 'RSI pass 4: % circuits added from the 1978 chart; % agree, % conflict; build-cited GM circuits named % of %',
    added, agree, conflict, named, cited;
END $check$;

COMMIT;
