-- Helper releases per platform. 'any' is one archive for every OS (the helper
-- is plain JavaScript); 'darwin' is what releases before this were, and stays
-- the default so older CI and installers keep working. The extension is 'any'.
alter table releases add column platform text not null default 'darwin'
  check (platform in ('any', 'darwin', 'linux', 'win32'));
update releases set platform = 'any' where kind = 'extension';
alter table releases drop constraint releases_pkey;
alter table releases add primary key (kind, version, platform);
