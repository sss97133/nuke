import { useState, useEffect } from 'react';
// Rotating action verbs hook (inspired by Claude's thinking animation)
export const useRotatingVerb = () => {
// Massive randomized list of automotive verbs - 700+ terms covering fabrication, engineering, racing, and physical activities
  const verbs = [
    'Balancing', 'Troubleshooting', 'Cerakoting', 'Installing', 'Checking', 'Fabricating', 'Bending', 'Blocking',
    'Pressure', 'Relocating', 'Dynoing', 'Fitting', 'Threading', 'Building', 'Vacuum', 'Fusing', 'Toeing', 'Scuffing',
    'Dollies', 'Burnouts', 'Testing', 'Ring', 'Diagnosing', 'Filling', 'Breaking', 'Brake', 'Proportioning', 'Deleting',
    'Mounting', 'Logging', 'Running', 'Pinion', 'Dipping', 'Bearings', 'Changing', 'Configuring', 'Claying', 'Priming',
    'Sequencing', 'Matching', 'Machines', 'Rev', 'Accelerating', 'Pushing', 'Threshold', 'Waxing', 'Parting', 'Caging',
    'Monitoring', 'Clutching', 'Magnafluxing', 'Seals', 'Braking', 'Grooving', 'Metal', 'And', 'Splicing', 'Castering',
    'Advancing', 'English', 'Visualizing', 'Setting', 'Camber', 'Compression', 'Feathering', 'Programming', 'Prepping',
    'Wrenching', 'Slamming', 'Brushing', 'Connecting', 'Coding', 'Reconditioning', 'Bracing', 'Crank', 'Adjusting',
    'Painting', 'Blasting', 'CV', 'MIG', 'Blending', 'Shrinking', 'Controllers', 'Flaring', 'Milling', 'Heads',
    'Flexible', 'Heel', 'Fluids', 'Stance', 'Calibrating', 'Blinking', 'U-joints', 'Dropping', 'Bagging', 'Gears',
    'Preload', 'Glazing', 'Profiling', 'Launching', 'Plasma', 'Overlap', 'Mapping', 'CNC', 'Sanding', 'Polishing',
    'Pistons', 'Stem', 'Polishers', 'Surface', 'Piston', 'Benching', 'Primer', 'Acid', 'Turning', 'Reading',
    'Buffers', 'Root', 'Resistance', 'Squatting', 'Bleeding', 'Honing', 'Rebuilding', 'Studs', 'Upgrading', 'Pickling',
    'Hooning', 'Cutting', 'Punching', 'Joints', 'Restoring', 'Tapping', 'Stretching', 'Backlash', 'Gapping', 'Replacing',
    'Torquing', 'Working', 'Tucking', 'Resurfacing', 'Designing', 'Taping', 'Lapping', 'Updating', 'Repairing', 'Washing',
    'Sleeving', 'Coiling', 'Simulating', 'Rolling', 'Bead', 'Leveling', 'Plating', 'Disconnecting', 'PLCs', 'Grinding',
    'Trading', 'Wiring', 'Human', 'C-notching', 'Fusion', 'Swirling', 'Hydro', 'Scanning', 'Presses', 'Architecting',
    'Aligning', 'Passivating', 'Systems', 'Satin', 'Applying', 'Shaving', 'Measuring', 'Hot', 'Gutting', 'Forming',
    'Flow', 'Tuning', 'Modeling', 'Tacking', 'Basecoating', 'Up', 'Interfaces', 'Transmissions', 'Degreeing', 'Wrapping',
    'Tanking', 'Operating', 'Chroming', 'Straightening', 'Folding', 'Optimizing', 'Attacking', 'Soldering', 'Drifting',
    'Jeweling', 'Pulling', 'Cylinders', 'SCADA', 'Spinning', 'Cadmium', 'Automation', 'Skimming', 'Sourcing', 'Buffing',
    'Software', 'Toe', 'Continuity', 'Throat', 'Undercut', 'Stalling', 'Blueprinting', 'Corner', 'Camshaft', 'Tweaking',
    'Depth', 'Shifting', 'Data', 'TIG', 'Ripping', 'Decking', 'Cornering', 'Rods', 'Finishing', 'Grounding',
    'Extending', 'Axles', 'Sensors', 'Prototyping', 'Powder', 'Wet', 'Stripping', 'Masking', 'LEDs', 'Versioning',
    'TPMS', 'Raking', 'Tabbing', 'Weld', 'Spraying', 'Transmission', 'Coating', 'Pilot', 'Face', 'Pass',
    'Showing', 'Casting', 'Weighting', 'Z-ing', 'Hunting', 'Hoses', 'Retarding', 'Rotors', 'Tires', 'Rendering',
    'Shearing', 'Smoothing', 'Removing', 'TCMs', 'Beading', 'Flashing', 'Welding', 'Shift', 'Tracking', 'Triangulating',
    'Leak', 'Hologramming', 'Deck', 'Downshifting', 'Rims', 'Venting', 'Lifting', 'Trail', 'Super', 'Debadging',
    'Sawing', 'Foot', 'Preloading', 'Etching', 'Clearing', 'Pump', 'Sealing', 'Finding', 'Switching', 'Swaging',
    'Lathes', 'Programmable', 'Chrome', 'Valves', 'Boosters', 'Raising', 'Stringer', 'Differentials', 'Using', 'Porting',
    'Penetration', 'Compounding', 'Hiding', 'Countersinking', 'Machining', 'Modding', 'Down', 'Analyzing', 'Chamfering',
    'Gauges', 'Crimping', 'Porosity', 'Cup', 'Upshifting', 'Denting', 'Timers', 'Slip', 'Cleaning', 'Short',
    'Galvanizing', 'Boosting', 'Rotating', 'Shimming', 'Cruising', 'Plates', 'Oil', 'Filters', 'Widening', 'Codes',
    'Lugs', 'Sanders', 'Debugging', 'Refactoring', 'Drag', 'Benchmarking', 'Master', 'Electroplating', 'Bands', 'Compressing',
    'Nickel', 'Left', 'Processing', 'Converters', 'Zinc', 'Rallying', 'Pressures', 'Linking', 'Acquiring', 'Inspecting',
    'Vapor', 'Boring', 'Telemetry', 'Iterating', 'Pitting', 'Peening', 'Backing', 'Robots', 'Routing', 'Pouring',
    'Logic', 'Switches', 'Collecting', 'Shredding', 'Racing', 'Control', 'ABS', 'Walking', 'Chopping', 'Phosphating',
    'Qualifying', 'Brazing', 'Black', 'Hammering', 'Wheels', 'Flushing', 'Seating', 'Capping', 'Dialing', 'Validating',
    'Angling', 'Facing', 'Acquisition', 'Knurling', 'Sectioning', 'Controlling', 'Parameters', 'Louvering', 'Throwout',
    'Clutches', 'Oxidizing', 'Gridding', 'Desoldering', 'Leg', 'Gaskets', 'Channeling', 'Drill', 'Double', 'Supervisory',
    'Diagnosing', 'Scanning', 'Reading', 'Clearing', 'Flashing', 'Programming', 'Mapping', 'Tuning', 'Calibrating', 'Installing',
    'Mounting', 'Configuring', 'Monitoring', 'Rebuilding', 'Clutching', 'Replacing', 'Resurfacing', 'Installing', 'Changing', 'Adjusting',
    'Rebuilding', 'Setting', 'Balancing', 'Flashing', 'Updating', 'Calibrating', 'Bleeding', 'Flushing', 'Changing', 'Replacing',
    'Turning', 'Resurfacing', 'Rebuilding', 'Flaring', 'Fitting', 'Testing', 'Diagnosing', 'Balancing', 'Mounting', 'Torquing',
    'Rotating', 'Programming', 'Repairing', 'Straightening', 'Coding', 'Programming', 'Scripting', 'Debugging', 'Flashing', 'Mapping',
    'Tuning', 'Logging', 'Analyzing', 'Processing', 'Monitoring', 'Calibrating', 'Configuring', 'Dynoing', 'Launching', 'Testing',
    'Optimizing', 'Analyzing', 'Data', 'Logging', 'Tuning', 'Lifting', 'Dropping', 'Pushing', 'Pulling', 'Rotating',
    'Spinning', 'Rolling', 'Tucking', 'Wrenching', 'Building', 'Restoring', 'Cruising', 'Fabricating', 'Tuning', 'Spinning',
    'Racing', 'Modding', 'Upgrading', 'Boosting', 'Drifting', 'Revving', 'Detailing', 'Collecting', 'Showing', 'Flipping',
    'Trading', 'Swapping', 'Hunting', 'Sourcing', 'Inspecting', 'Diagnosing', 'Tweaking', 'Dialing', 'Hooning', 'Launching',
    'Burnouts', 'Drag', 'Tracking', 'AutoXing', 'Rallying', 'Attacking', 'Ripping', 'Shredding', 'Lapping', 'Gridding',
    'Pitting', 'Qualifying', 'Cornering', 'Braking', 'Accelerating', 'Shifting', 'Downshifting', 'Upshifting', 'Heel', 'Toeing',
    'Rev', 'Matching', 'Double', 'Clutching', 'Trail', 'Braking', 'Threshold', 'Braking', 'Left', 'Foot', 'Braking',
    'Slip', 'Angling', 'Counter', 'Steering', 'CNC', 'Machining', 'Programming', 'Operating', 'Lathes', 'Milling',
    'Machines', 'Grinders', 'Sanders', 'Polishers', 'Buffers', 'Drill', 'Presses', 'Tapping', 'Machines', 'Threading',
    'PLCs', 'Programmable', 'Logic', 'Controllers', 'Programming', 'SCADA', 'Systems', 'Supervisory', 'Control', 'And',
    'Data', 'Acquisition', 'Configuring', 'HMI', 'Human', 'Machine', 'Interfaces', 'Designing'
  ];
const [currentVerb, setCurrentVerb] = useState(verbs[0]);
useEffect(() => {
    const getRandomInterval = () => {
      // Variable speeds: 50% chance fast (500-1000ms), 30% medium (1000-2000ms), 20% slow (2000-4000ms)
      const rand = Math.random();
      if (rand < 0.5) {
        return Math.random() * 500 + 500; // 500-1000ms (FAST)
      } else if (rand < 0.8) {
        return Math.random() * 1000 + 1000; // 1000-2000ms (MEDIUM)
      } else {
        return Math.random() * 2000 + 2000; // 2000-4000ms (SLOW)
      }
    };
    
    let timeoutId: NodeJS.Timeout;
    
    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        setCurrentVerb(prev => {
          const currentIndex = verbs.indexOf(prev);
          const nextIndex = (currentIndex + 1) % verbs.length;
          return verbs[nextIndex];
        });
        scheduleNext();
      }, getRandomInterval());
    };
    
    scheduleNext();
    
    return () => clearTimeout(timeoutId);
  }, []);
  
  return currentVerb;
};

