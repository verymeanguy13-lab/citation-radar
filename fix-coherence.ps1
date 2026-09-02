Write-Host "Fixing site coherence: navigation + save-search..." -ForegroundColor Cyan

$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$file1 = @'
'use client';

import { useSession } from 'next-auth/react';
import SignOutButton from './dashboard/sign-out-button';

export default function SiteNav() {
  const { data: session, status } = useSession();

  return (
    <div
      className="container"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 'var(--space-3)',
        paddingBottom: 'var(--space-3)',
      }}
    >
      <a href="/" style={{ textDecoration: 'none', fontWeight: 700, fontSize: '15px', color: 'var(--color-text-primary)' }}>
        CitationRadar
      </a>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        {status === 'loading' ? null : session ? (
          <>
            <a href="/" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Search
            </a>
            <a href="/dashboard" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Dashboard
            </a>
            <a href="/saved-searches" className="text-muted" style={{ fontSize: '13px', textDecoration: 'none' }}>
              Saved Searches
            </a>
            {session.user?.plan !== 'pro' ? (
              <a href="/checkout" className="text-secondary" style={{ fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
                Upgrade to Pro
              </a>
            ) : null}
            <SignOutButton />
          </>
        ) : (
          <>
            <a href="/login" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              Sign in
            </a>
            <a href="/signup" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Get email alerts
            </a>
          </>
        )}
      </div>
    </div>
  );
}

'@
[System.IO.File]::WriteAllText("$PWD\app\site-nav.js", $file1, $utf8NoBom)
Write-Host "  Wrote app\site-nav.js" -ForegroundColor Green

$file2 = @'
import './globals.css';
import Providers from './providers';
import SiteNav from './site-nav';

export const metadata = {
  title: 'CitationRadar',
  description: 'Restaurant health inspection alerts for NYC and Toronto',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}

'@
[System.IO.File]::WriteAllText("$PWD\app\layout.js", $file2, $utf8NoBom)
Write-Host "  Wrote app\layout.js" -ForegroundColor Green

$file3 = @'
// CitationRadar -- Search & Filter UI (Session 7)
//
// City is the first, required choice -- not just another filter. This
// reinforces the city-scoping rule from Section 1 at the UI layer, on
// top of the database trigger from Session 3. No login required: this
// is the free top-of-funnel view.
//
// Navigation (sign in / sign up / dashboard links) lives in
// app/site-nav.js, rendered globally from app/layout.js.
//
// Coherence fix: added SaveSearchButton directly on the results page --
// previously saving a search required navigating away to a separate
// /saved-searches page with no way to carry the current filters over.

import { pool } from '../lib/db';
import SaveSearchButton from './save-search-button';

const CATEGORIES = ['pest', 'sanitation', 'temperature', 'other'];

function gradeBadgeClass(grade) {
  if (!grade) return null;
  const g = grade.toLowerCase();
  if (g === 'a' || g === 'pass') return 'badge--ok';
  if (g === 'b' || g.includes('conditional')) return 'badge--warning';
  if (g === 'c' || g.includes('closed')) return 'badge--critical';
  return null;
}

function mapsLink(legalName, address) {
  const query = encodeURIComponent(`${legalName} ${address || ''}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

async function getResults({ city, category, area, dateFrom, dateTo }) {
  const conditions = ['v.city_code = $1'];
  const params = [city];

  if (category && CATEGORIES.includes(category)) {
    params.push(category);
    conditions.push(`v.category = $${params.length}`);
  }
  if (area) {
    params.push(`%${area}%`);
    conditions.push(`(e.area ILIKE $${params.length} OR e.address ILIKE $${params.length})`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`v.inspection_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`v.inspection_date <= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT e.legal_name, e.address, e.area, e.phone, v.category, v.grade, v.inspection_date, v.critical_flag, v.violation_description
     FROM violations v
     JOIN establishments e ON v.establishment_id = e.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY v.inspection_date DESC
     LIMIT 50`,
    params
  );

  try {
    await pool.query(
      `INSERT INTO search_events (city_code, category_filter, area_filter, result_count) VALUES ($1, $2, $3, $4)`,
      [city, category || null, area || null, rows.length]
    );
  } catch (err) {
    console.error('search_events logging failed (non-fatal):', err);
  }

  return rows;
}

function CitySelector() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
      <h1 style={{ fontSize: '28px', marginBottom: 'var(--space-2)' }}>CitationRadar</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-6)', maxWidth: '520px' }}>
        Pick a city to search. Every result you see stays scoped to that city only -- searches never mix NYC and Toronto data.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <a href="/?city=NYC" className="card" style={{ textDecoration: 'none', minWidth: '220px', borderTop: '3px solid var(--color-city-nyc)' }}>
          <span className="city-tag city-tag--nyc">NYC</span>
          <h2 style={{ fontSize: '20px', margin: 'var(--space-3) 0 var(--space-1)', color: 'var(--color-text-primary)' }}>
            New York City
          </h2>
          <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>DOHMH restaurant inspections</p>
        </a>
        <a href="/?city=TOR" className="card" style={{ textDecoration: 'none', minWidth: '220px', borderTop: '3px solid var(--color-city-toronto)' }}>
          <span className="city-tag city-tag--toronto">Toronto</span>
          <h2 style={{ fontSize: '20px', margin: 'var(--space-3) 0 var(--space-1)', color: 'var(--color-text-primary)' }}>
            Toronto
          </h2>
          <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>DineSafe inspections</p>
        </a>
      </div>
    </div>
  );
}

function FilterForm({ city, category, area, dateFrom, dateTo }) {
  return (
    <form method="GET" action="/" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
      <input type="hidden" name="city" value={city} />
      <div>
        <label htmlFor="category" className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Category</label>
        <select id="category" name="category" defaultValue={category || ''}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="area" className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>Area or address</label>
        <input id="area" name="area" type="text" defaultValue={area || ''} placeholder={city === 'NYC' ? 'e.g. Brooklyn' : 'e.g. Queen St'} />
      </div>
      <div>
        <label htmlFor="dateFrom" className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>From</label>
        <input id="dateFrom" name="dateFrom" type="date" defaultValue={dateFrom || ''} />
      </div>
      <div>
        <label htmlFor="dateTo" className="text-secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}>To</label>
        <input id="dateTo" name="dateTo" type="date" defaultValue={dateTo || ''} />
      </div>
      <button type="submit" className="btn btn-primary">Apply filters</button>
      <a href={`/?city=${city}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>Clear</a>
    </form>
  );
}

function ResultCard({ result, city }) {
  const badgeClass = gradeBadgeClass(result.grade);
  return (
    <div className={`card city-accent--${city === 'NYC' ? 'nyc' : 'toronto'}`} style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
            <span className={`city-tag city-tag--${city === 'NYC' ? 'nyc' : 'toronto'}`}>{city}</span>
            {result.critical_flag ? <span className="badge badge--critical">Critical</span> : null}
            {badgeClass ? <span className={`badge ${badgeClass}`}>{result.grade}</span> : null}
          </div>
          <h3 style={{ fontSize: '16px', margin: '0 0 4px' }}>{result.legal_name}</h3>
          <p className="text-secondary" style={{ fontSize: '13px', margin: '0 0 4px' }}>{result.address}</p>
          <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>
            {result.category.charAt(0).toUpperCase() + result.category.slice(1)} &middot; Inspected {new Date(result.inspection_date).toLocaleDateString()}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {result.phone ? <p style={{ fontSize: '13px', margin: '0 0 6px' }}>{result.phone}</p> : null}
          <a href={mapsLink(result.legal_name, result.address)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px' }}>
            View on Maps &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function Home({ searchParams }) {
  const params = await searchParams;
  const city = params?.city === 'NYC' || params?.city === 'TOR' ? params.city : null;

  if (!city) {
    return <CitySelector />;
  }

  const category = params?.category || '';
  const area = params?.area || '';
  const dateFrom = params?.dateFrom || '';
  const dateTo = params?.dateTo || '';

  const results = await getResults({ city, category, area, dateFrom, dateTo });

  return (
    <div className="container" style={{ paddingTop: 'var(--space-6)', paddingBottom: 'var(--space-8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <div>
          <h1 style={{ fontSize: '22px', margin: '0 0 4px' }}>CitationRadar</h1>
          <a href="/" className="text-muted" style={{ fontSize: '13px' }}>&larr; Change city</a>
        </div>
        <span className={`city-tag city-tag--${city === 'NYC' ? 'nyc' : 'toronto'}`}>{city === 'NYC' ? 'New York City' : 'Toronto'}</span>
      </div>

      <FilterForm city={city} category={category} area={area} dateFrom={dateFrom} dateTo={dateTo} />

      <div style={{ marginBottom: 'var(--space-5)' }}>
        <SaveSearchButton city={city} category={category} area={area} />
      </div>

      {results.length === 0 ? (
        <p className="text-muted">No violations match these filters yet. Try widening the date range or clearing a filter.</p>
      ) : (
        <>
          <p className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--space-3)' }}>{results.length} result{results.length === 1 ? '' : 's'}</p>
          {results.map((r, i) => (
            <ResultCard key={i} result={r} city={city} />
          ))}
        </>
      )}
    </div>
  );
}

'@
[System.IO.File]::WriteAllText("$PWD\app\page.js", $file3, $utf8NoBom)
Write-Host "  Wrote app\page.js" -ForegroundColor Green

$file4 = @'
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

export default function SaveSearchButton({ city, category, area }) {
  const { data: session, status } = useSession();
  const [state, setState] = useState('idle'); // idle | saving | saved | limit | error

  async function handleSave() {
    const label = window.prompt('Name this saved search:', `${city} ${category || 'all categories'}${area ? ' - ' + area : ''}`);
    if (!label) return;

    setState('saving');
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city_code: city,
          label,
          category_filter: category || null,
          area_filter: area || null,
        }),
      });

      if (res.status === 403) {
        setState('limit');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('saved');
    } catch {
      setState('error');
    }
  }

  if (state === 'saved') {
    return <span className="badge badge--ok">Saved -- manage it on your dashboard</span>;
  }
  if (state === 'limit') {
    return (
      <span className="text-secondary" style={{ fontSize: '13px' }}>
        Free plan allows 1 saved search. <a href="/checkout" style={{ fontWeight: 600 }}>Upgrade to Pro</a> for more.
      </span>
    );
  }
  if (state === 'error') {
    return <span className="text-secondary" style={{ fontSize: '13px' }}>Couldn't save that -- try again in a moment.</span>;
  }

  if (status === 'loading') {
    return null;
  }

  if (!session) {
    return (
      <a href="/login" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
        Sign in to save this search
      </a>
    );
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={handleSave} disabled={state === 'saving'}>
      {state === 'saving' ? 'Saving...' : 'Save this search'}
    </button>
  );
}

'@
[System.IO.File]::WriteAllText("$PWD\app\save-search-button.js", $file4, $utf8NoBom)
Write-Host "  Wrote app\save-search-button.js" -ForegroundColor Green


Write-Host ""
Write-Host "All 4 files updated." -ForegroundColor Cyan
Write-Host "Next:" -ForegroundColor Yellow
Write-Host '  git add .'
Write-Host '  git commit -m "Fix navigation and save-search coherence"'
Write-Host '  git push'
