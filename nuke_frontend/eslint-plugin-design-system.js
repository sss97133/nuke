/**
 * ESLint Plugin: Design System Enforcement
 *
 * Catches violations of the Nuke design system:
 *   - Hardcoded hex colors in JSX/TSX (allowlist for Recharts/SVG/Leaflet)
 *   - border-radius > 0
 *   - box-shadow (except 'none')
 *   - background: linear-gradient
 *   - Font families other than Arial / Courier New
 *   - Inline style= with color/background hex values
 *
 * Existing violations are grandfathered — add eslint-disable comments as needed.
 * New violations fail lint on every build.
 */

// Files/paths where hex colors are allowed (chart libs, SVG, map tiles)
const ALLOWLISTED_PATTERNS = [
  /recharts/i,
  /chart/i,
  /svg/i,
  /leaflet/i,
  /maplibre/i,
  /d3/i,
  /deck\.gl/i,
  /three/i,
  /canvas/i,
  /\.test\./,
  /\.spec\./,
  /\.stories\./,
];

// Known CSS variable patterns that are OK
const CSS_VAR_RE = /var\(--/;

// Hex color regex: #rgb, #rgba, #rrggbb, #rrggbbaa
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

// SVG/chart attribute names where hex is expected
const CHART_PROPS = new Set([
  'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor',
  'colorInterpolation', 'colorProfile',
]);

// Props that commonly accept colors
const COLOR_PROPS = new Set([
  'color', 'backgroundColor', 'background', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'outlineColor', 'textDecorationColor', 'caretColor', 'accentColor',
  'fill', 'stroke', 'stopColor',
]);

const BANNED_FONT_RE = /font-?[Ff]amily\s*:\s*(?!['"]?(?:Arial|Courier New|monospace|inherit|var\(--|system-ui|sans-serif|--)[^'"]*['"]?)/;

/**
 * Rule: no-hardcoded-colors
 * Catches hex color literals in JSX style objects and template literals.
 */
const noHardcodedColors = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow hardcoded hex colors — use CSS variables from unified-design-system.css',
      recommended: true,
    },
    messages: {
      hardcodedColor:
        'Hardcoded color "{{value}}" — use a CSS variable from unified-design-system.css instead (e.g. var(--text), var(--accent)).',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename?.() || context.filename || '';
    // Skip allowlisted files
    if (ALLOWLISTED_PATTERNS.some(re => re.test(filename))) return {};

    return {
      // Catch: style={{ color: '#ff0000' }}
      Property(node) {
        if (
          node.value &&
          node.value.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          HEX_COLOR_RE.test(node.value.value) &&
          !CSS_VAR_RE.test(node.value.value)
        ) {
          // Check if this is inside a style object or a color-related prop
          const propName = node.key?.name || node.key?.value || '';
          if (COLOR_PROPS.has(propName) || isInsideStyleProp(node)) {
            context.report({
              node: node.value,
              messageId: 'hardcodedColor',
              data: { value: node.value.value },
            });
          }
        }
      },

      // Catch: style={{ background: `#fff` }} in template literals
      TemplateLiteral(node) {
        if (!isInsideStyleProp(node)) return;
        for (const quasi of node.quasis) {
          if (HEX_COLOR_RE.test(quasi.value.raw) && !CSS_VAR_RE.test(quasi.value.raw)) {
            context.report({
              node,
              messageId: 'hardcodedColor',
              data: { value: quasi.value.raw.match(HEX_COLOR_RE)?.[0] || '?' },
            });
          }
        }
      },
    };
  },
};

/**
 * Rule: no-border-radius
 * Catches borderRadius > 0 in inline styles.
 */
const noBorderRadius = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow border-radius — design system requires zero border-radius',
      recommended: true,
    },
    messages: {
      noBorderRadius:
        'border-radius is not allowed. The design system requires zero border-radius on all elements.',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const propName = node.key?.name || node.key?.value || '';
        if (propName !== 'borderRadius') return;

        // Allow borderRadius: 0 or borderRadius: '0' or '0px'
        if (node.value?.type === 'Literal') {
          const val = node.value.value;
          if (val === 0 || val === '0' || val === '0px') return;
          context.report({ node, messageId: 'noBorderRadius' });
        } else if (node.value?.type !== 'Literal') {
          // Could be a variable/expression — skip (can't statically check)
        }
      },
    };
  },
};

/**
 * Rule: no-box-shadow
 * Catches boxShadow in inline styles (except 'none').
 */
const noBoxShadow = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow box-shadow — design system uses flat styling',
      recommended: true,
    },
    messages: {
      noBoxShadow:
        'box-shadow is not allowed. The design system uses flat styling with no shadows.',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const propName = node.key?.name || node.key?.value || '';
        if (propName !== 'boxShadow') return;

        if (node.value?.type === 'Literal') {
          const val = node.value.value;
          if (val === 'none' || val === '0' || val === 0) return;
          context.report({ node, messageId: 'noBoxShadow' });
        }
      },
    };
  },
};

/**
 * Rule: no-gradient
 * Catches background: linear-gradient(...) in inline styles.
 */
const noGradient = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow gradients — design system uses flat colors',
      recommended: true,
    },
    messages: {
      noGradient:
        'Gradients are not allowed. The design system uses flat solid colors.',
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        const propName = node.key?.name || node.key?.value || '';
        if (propName !== 'background' && propName !== 'backgroundImage') return;

        if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
          if (/linear-gradient|radial-gradient|conic-gradient/i.test(node.value.value)) {
            context.report({ node: node.value, messageId: 'noGradient' });
          }
        }
        if (node.value?.type === 'TemplateLiteral') {
          for (const quasi of node.value.quasis) {
            if (/linear-gradient|radial-gradient|conic-gradient/i.test(quasi.value.raw)) {
              context.report({ node: node.value, messageId: 'noGradient' });
              break;
            }
          }
        }
      },
    };
  },
};

/**
 * Rule: no-banned-fonts
 * Catches font-family other than Arial / Courier New in inline styles.
 */
const noBannedFonts = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Only Arial and Courier New are allowed fonts',
      recommended: true,
    },
    messages: {
      bannedFont:
        'Font "{{value}}" is not in the design system. Only Arial and Courier New are allowed.',
    },
    schema: [],
  },
  create(context) {
    const ALLOWED = ['arial', 'courier new', 'monospace', 'inherit', 'sans-serif'];

    return {
      Property(node) {
        const propName = node.key?.name || node.key?.value || '';
        if (propName !== 'fontFamily') return;

        if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
          const val = node.value.value.toLowerCase();
          // Check if ALL font families in the value are allowed
          const families = val.split(',').map(f => f.trim().replace(/['"]/g, ''));
          const banned = families.filter(f => f && !ALLOWED.includes(f) && !f.startsWith('var(--'));
          if (banned.length > 0) {
            context.report({
              node: node.value,
              messageId: 'bannedFont',
              data: { value: banned.join(', ') },
            });
          }
        }
      },
    };
  },
};

// Helper: walk up the AST to check if node is inside a `style` JSX attribute
function isInsideStyleProp(node) {
  let current = node.parent;
  let depth = 0;
  while (current && depth < 10) {
    // JSXAttribute with name "style"
    if (
      current.type === 'JSXAttribute' &&
      current.name?.name === 'style'
    ) {
      return true;
    }
    // Variable assigned to style-like name
    if (
      current.type === 'VariableDeclarator' &&
      current.id?.name &&
      /style/i.test(current.id.name)
    ) {
      return true;
    }
    current = current.parent;
    depth++;
  }
  return false;
}

// Plugin export
const plugin = {
  meta: {
    name: 'eslint-plugin-design-system',
    version: '1.0.0',
  },
  rules: {
    'no-hardcoded-colors': noHardcodedColors,
    'no-border-radius': noBorderRadius,
    'no-box-shadow': noBoxShadow,
    'no-gradient': noGradient,
    'no-banned-fonts': noBannedFonts,
  },
};

export default plugin;
