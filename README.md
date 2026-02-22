# ManaMargin

**ManaMargin** is a comprehensive Magic: The Gathering price comparison and pack simulator platform built with React, TypeScript, Tailwind CSS, and Supabase.

## Features

### ✅ Implemented Features

1. **📊 Dashboard**
   - Real-time statistics (total products, offers, commander decks, cards)
   - Featured sets with product counts
   - Low stock alerts
   - Quick navigation to all features

2. **🛒 Price Comparison**
   - Compare sealed product prices across multiple retailers
   - Advanced filtering (by set, product type, foil status, marketplace)
   - Real-time search functionality
   - Sortable table with price, shipping, and stock information
   - Links directly to retailer product pages

3. **⚔️ Commander Deck Valuation**
   - Browse all preconstructed commander decks
   - View complete deck lists with card details
   - Real-time card price valuations
   - Calculate total deck value
   - Filter by release date, commander, and price

4. **🎲 Pack Simulator**
   - Simulate opening booster packs from any set in your database
   - Realistic pack structure (10 commons, 3 uncommons, 1 rare/mythic, 25% foil chance)
   - Open 10, 20, 30, 40, or 50 packs at once
   - View individual pack results with card values
   - Statistical analysis (average value, median, best/worst pack)
   - Expected value (EV) calculations based on real market prices

### 🚧 Planned Features

- **Inventory Management** - Track your personal collection
- **Price History Graphs** - Visualize price trends over time
- **Product Name Standardization** - Admin interface for managing product names
- **Wishlist** - Save products you want to track

## Tech Stack

- **Frontend Framework:** React 18 with TypeScript
- **Build Tool:** Vite 5
- **Styling:** Tailwind CSS 3
- **Database:** Supabase (PostgreSQL)
- **Routing:** React Router v6
- **State Management:** React Hooks + Custom Hooks

## Project Structure

```
ManaMargin/
├── src/
│   ├── components/
│   │   ├── common/          # Reusable UI components
│   │   ├── layout/          # Header, Footer
│   │   ├── tables/          # Data table components
│   │   ├── filters/         # Filter components
│   │   ├── commander/       # Commander deck components
│   │   └── simulator/       # Pack simulator components
│   ├── hooks/               # Custom React hooks
│   ├── pages/               # Page components
│   ├── services/            # API/Database services
│   ├── types/               # TypeScript type definitions
│   ├── utils/               # Utility functions
│   ├── styles/              # Global styles
│   ├── App.tsx              # Main app component
│   └── main.tsx             # Entry point
├── public/                  # Static assets
├── .env.local               # Environment variables (not committed)
├── package.json             # Dependencies
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind configuration
└── tsconfig.json            # TypeScript configuration
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- A Supabase account with a project set up
- Database tables and views already created (see database schema documentation)

### Installation

1. **Clone the repository** (or navigate to your project directory):
   ```bash
   cd c:\Users\jerem\Programs\ManaMargin
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file in the root directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

   Get these values from your Supabase dashboard:
   - Go to Settings > API
   - Copy the Project URL and anon/public key

4. **Generate TypeScript types from Supabase** (optional but recommended):
   ```bash
   npm run types:generate
   ```

   Note: This requires the Supabase CLI and your project ID. If not set up, you can skip this step - types are already included.

5. **Start the development server**:
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3004`

### Available Scripts

- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint
- `npm run types:generate` - Generate TypeScript types from Supabase schema

## Database Setup

This frontend connects to a Supabase PostgreSQL database with the following key tables and views:

### Tables
- `offers` - Price offers from retailers
- `cards` - Magic: The Gathering card data
- `commander_deck_info` - Commander deck metadata
- `commander_deck_cards` - Card lists for commander decks

### Key Views
- `offers_latest_enriched` - Latest offers with full product metadata
- `v_commander_deck_values` - Commander deck valuations
- `v_commander_deck_card_details` - Deck cards with prices
- `v_cards_by_set_rarity` - Cards grouped by set and rarity (for pack simulator)
- `v_card_latest_price` - Current card prices
- `v_movers_24h` - Price changes in last 24 hours

For full database schema documentation, see `ManaMargin-Documentation.md`.

## Configuration

### Tailwind CSS Theme

The app uses a custom MTG-inspired color palette defined in `tailwind.config.js`:

- **Primary Colors:** Blues and purples for main UI elements
- **Mana Colors:** W/U/B/R/G color variables for MTG mana symbols
- **Semantic Colors:** Success, warning, error states

### TypeScript Configuration

- **Strict Mode:** Enabled for maximum type safety
- **Path Aliases:** `@/` maps to `src/` directory
- **Target:** ES2020 with modern browser support

## Development Guide

### Creating a New Page

1. Create page component in `src/pages/YourPage.tsx`
2. Add route in `src/App.tsx`
3. Add route constant in `src/utils/constants.ts`
4. Update navigation in `src/components/layout/Header.tsx`

### Creating a New Service

1. Create service file in `src/services/yourService.ts`
2. Define service methods with proper TypeScript types
3. Use `supabase` client from `src/services/supabase.ts`
4. Handle errors and return proper data types

### Using Custom Hooks

**useSupabaseQuery** - For data fetching:
```typescript
const { data, loading, error } = useSupabaseQuery(
  () => yourService.getData(),
  [dependencies]
)
```

**useFilterState** - For filter management:
```typescript
const { filters, updateFilter, resetFilters } = useFilterState()
```

## Deployment

### Deploying to Netlify

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Create `netlify.toml`** (already included):
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"

   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

3. **Deploy via Netlify CLI** or connect your Git repository to Netlify

4. **Set environment variables** in Netlify dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

5. **Deploy**: Netlify will automatically build and deploy your site

### Environment Variables

**Development** (`.env.local`):
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

**Production** (Netlify/Vercel):
- Same variables, configured in hosting dashboard

## Troubleshooting

### Common Issues

**Tailwind styles not working:**
- Ensure `postcss.config.cjs` (not `.js`) exists
- Check that Tailwind CSS v3 is installed (not v4)
- Verify `content` paths in `tailwind.config.js`

**Supabase connection errors:**
- Verify `.env.local` has correct URL and key
- Check Supabase project is not paused
- Ensure database tables and views exist
- Check RLS (Row Level Security) policies allow anonymous access

**Pack Simulator not loading cards:**
- Verify `cards` table has data with `set_code` values
- Check that `v_cards_by_set_rarity` view exists
- Ensure `v_card_latest_price` view exists for pricing
- Check browser console for specific error messages

**TypeScript errors:**
- Run `npm run types:generate` to update Supabase types
- Check that `src/types/database.ts` matches your schema

### Development Tips

1. **Enable verbose logging**: Check browser console (F12) for detailed error messages and logs
2. **Use React DevTools**: Install React Developer Tools extension for component inspection
3. **Test Supabase queries**: Use Supabase Studio's SQL Editor to test queries directly
4. **Check Network tab**: See actual API calls and responses in browser DevTools

## Features in Detail

### Price Comparison

The price comparison feature queries the `offers_latest_enriched` view which combines:
- Product information (name, set, type)
- Latest price from each marketplace
- Stock status and shipping costs
- Direct links to product pages

Filters use dropdown views (`offers_dropdown_*`) for efficient option loading.

### Pack Simulator

The pack simulator:
1. Loads available sets from your `cards` table
2. Queries `v_cards_by_set_rarity` to get card pools by rarity
3. Randomly selects cards following standard pack structure:
   - 10 commons
   - 3 uncommons
   - 1 rare or mythic (12.5% mythic rate)
   - 25% chance of foil card (can be any rarity)
4. Fetches prices from `v_card_latest_price`
5. Calculates pack value and statistics

### Commander Decks

Commander deck feature:
1. Lists all decks from `v_commander_deck_values`
2. Shows deck metadata (code, name, release date, commanders)
3. Displays full card list from `v_commander_deck_card_details`
4. Calculates total deck value based on current market prices
5. Highlights commanders and high-value cards

## Contributing

This is a personal project, but suggestions and feedback are welcome!

## License

Private project - All rights reserved

## Support

For issues, bugs, or questions:
1. Check the Troubleshooting section above
2. Review browser console for error messages
3. Check Supabase logs in Supabase Studio
4. Verify database schema matches expectations

---

**Built with ❤️ for the Magic: The Gathering community**
