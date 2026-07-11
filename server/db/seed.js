function seedCategories(db) {
  const insertGroup = db.prepare(
    'INSERT INTO categories (name, parent_id, kind, color, icon) VALUES (?, NULL, ?, ?, ?)'
  );
  const insertCat = db.prepare(
    'INSERT INTO categories (name, parent_id, kind, color, icon) VALUES (?, ?, ?, ?, ?)'
  );

  const groups = [
    { name: 'Income',       kind: 'income',   color: '#10b981', icon: 'trending-up' },
    { name: 'Housing',      kind: 'expense',  color: '#6366f1', icon: 'home' },
    { name: 'Food',         kind: 'expense',  color: '#f59e0b', icon: 'utensils' },
    { name: 'Transport',    kind: 'expense',  color: '#3b82f6', icon: 'car' },
    { name: 'Health',       kind: 'expense',  color: '#ec4899', icon: 'heart' },
    { name: 'Lifestyle',    kind: 'expense',  color: '#8b5cf6', icon: 'star' },
    { name: 'Finance',      kind: 'expense',  color: '#64748b', icon: 'landmark' },
    { name: 'Family',       kind: 'expense',  color: '#f97316', icon: 'users' },
    { name: 'Transfers',    kind: 'transfer', color: '#94a3b8', icon: 'arrow-right-left' },
  ];

  const children = {
    Income:    [
      { name: 'Salary',        color: '#10b981' },
      { name: 'Interest',      color: '#34d399' },
      { name: 'Dividends',     color: '#6ee7b7' },
      { name: 'Other Income',  color: '#a7f3d0' },
    ],
    Housing:   [
      { name: 'Mortgage',      color: '#6366f1' },
      { name: 'Rent',          color: '#818cf8' },
      { name: 'Utilities',     color: '#a5b4fc' },
      { name: 'Internet',      color: '#c7d2fe' },
      { name: 'Home Maintenance', color: '#e0e7ff' },
      { name: 'Insurance – Home', color: '#818cf8' },
    ],
    Food:      [
      { name: 'Groceries',     color: '#f59e0b' },
      { name: 'Dining Out',    color: '#fbbf24' },
      { name: 'Takeaway',      color: '#fcd34d' },
      { name: 'Coffee',        color: '#fde68a' },
    ],
    Transport: [
      { name: 'Fuel',          color: '#3b82f6' },
      { name: 'Car Registration', color: '#60a5fa' },
      { name: 'Car Maintenance',  color: '#93c5fd' },
      { name: 'Insurance – Car',  color: '#bfdbfe' },
      { name: 'Public Transport', color: '#60a5fa' },
      { name: 'Parking & Tolls',  color: '#93c5fd' },
    ],
    Health:    [
      { name: 'Medical',       color: '#ec4899' },
      { name: 'Pharmacy',      color: '#f472b6' },
      { name: 'Gym & Fitness', color: '#f9a8d4' },
    ],
    Lifestyle: [
      { name: 'Subscriptions', color: '#8b5cf6' },
      { name: 'Entertainment', color: '#a78bfa' },
      { name: 'Shopping',      color: '#c4b5fd' },
      { name: 'Clothing',      color: '#ddd6fe' },
      { name: 'Holidays',      color: '#8b5cf6' },
      { name: 'Pets',          color: '#a78bfa' },
    ],
    Finance:   [
      { name: 'Bank Fees',     color: '#64748b' },
      { name: 'Loan Repayment',color: '#94a3b8' },
      { name: 'Super',         color: '#cbd5e1' },
      { name: 'Tax',           color: '#94a3b8' },
    ],
    Family:    [
      { name: 'Kids',          color: '#f97316' },
      { name: 'School Fees',   color: '#fb923c' },
      { name: 'Gifts',         color: '#fdba74' },
      { name: 'Christmas',     color: '#fed7aa' },
    ],
    Transfers: [
      { name: 'Internal Transfer', color: '#94a3b8' },
    ],
  };

  for (const g of groups) {
    const { lastInsertRowid: gid } = insertGroup.run(g.name, g.kind, g.color, g.icon);
    for (const c of (children[g.name] || [])) {
      insertCat.run(c.name, gid, g.kind, c.color, null);
    }
  }

  // Seed a handful of starter rules
  const insertRule = db.prepare(
    'INSERT INTO category_rules (match_type, pattern, category_id, priority) VALUES (?, ?, ?, ?)'
  );
  const catByName = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name);

  const rules = [
    ['contains', 'woolworths',   'Groceries',    10],
    ['contains', 'coles',        'Groceries',    10],
    ['contains', 'aldi',         'Groceries',    10],
    ['contains', 'iga ',         'Groceries',    10],
    ['contains', 'mcdonald',     'Takeaway',     10],
    ['contains', 'kfc',          'Takeaway',     10],
    ['contains', 'uber eats',    'Takeaway',     10],
    ['contains', 'doordash',     'Takeaway',     10],
    ['contains', 'menulog',      'Takeaway',     10],
    ['contains', 'netflix',      'Subscriptions',10],
    ['contains', 'spotify',      'Subscriptions',10],
    ['contains', 'amazon prime', 'Subscriptions',10],
    ['contains', 'disney',       'Subscriptions',10],
    ['contains', 'fuel',         'Fuel',         10],
    ['contains', 'bp ',          'Fuel',         10],
    ['contains', 'caltex',       'Fuel',         10],
    ['contains', 'ampol',        'Fuel',         10],
    ['contains', '7-eleven',     'Fuel',         10],
    ['contains', 'salary',       'Salary',       5],
    ['contains', 'payroll',      'Salary',       5],
  ];

  for (const [match_type, pattern, catName, priority] of rules) {
    const cat = catByName(catName);
    if (cat) insertRule.run(match_type, pattern, cat.id, priority);
  }
}

module.exports = { seedCategories };
