-- numberOfKeys: 8
--
-- place_pixel: provera i upis poteza kao jedna atomična operacija.
-- redis izvršava skriptu u jednoj niti, bez prekida: nijedna druga komanda (ni sa druge
-- api instance) ne može da se ubaci između provere cooldown-a i upisa piksela, pa nema
-- race condition-a (50 paralelnih poteza istog korisnika daje tačno jedan uspeh).
-- uz to je jedan round-trip umesto ~8 komandi. redis nema rollback, zato se sve provere
-- rade pre prvog upisa; od prvog upisa nadalje izvršavaju se svi upisi.
--
-- KEYS: 1 canvas:main     2 canvas:status   3 cooldown:{uid}   4 zones:active
--       5 stream:moves    6 canvas:version  7 config:canvas    8 canvas:updates (pub/sub kanal)
-- ARGV: 1 uid  2 username  3 x  4 y  5 color  6 nowMs  7 role
--
-- povratna vrednost:
--   {'OK', streamId, version, cooldownMs}
--   {'ERR_NOT_READY'} | {'ERR_INVALID_COORDS'} | {'ERR_COOLDOWN', preostaloMs}
--   {'ERR_ZONE_LOCKED', lockId}
-- boja se proverava u gateway-u, koordinate ovde (dimenzije su u config:canvas)

-- platno prima poteze samo kad je status ready
local status = redis.call('GET', KEYS[2])
if status ~= 'ready' then return {'ERR_NOT_READY'} end

local isAdmin = ARGV[7] == 'admin'
local cfg = redis.call('HMGET', KEYS[7], 'width', 'height', 'cooldown_ms')
local width, height = tonumber(cfg[1]), tonumber(cfg[2])
local cooldownMs = tonumber(cfg[3]) or 0
if not width or not height then return {'ERR_NOT_READY'} end

local x, y = tonumber(ARGV[3]), tonumber(ARGV[4])
if not x or not y or x ~= math.floor(x) or y ~= math.floor(y)
   or x < 0 or y < 0 or x >= width or y >= height then
  return {'ERR_INVALID_COORDS'}
end

if not isAdmin then
  -- preostalo trajanje cooldown-a (ključ ističe sam)
  local ttl = redis.call('PTTL', KEYS[3])
  if ttl > 0 then return {'ERR_COOLDOWN', ttl} end

  -- aktivne zone: score = expiresAt, istekle preskačemo (briše ih scheduler);
  -- član je "lockId|x1|y1|x2|y2|ownerId", vlasnik zone sme da boji u njoj
  local zones = redis.call('ZRANGEBYSCORE', KEYS[4], '(' .. ARGV[6], '+inf')
  for _, m in ipairs(zones) do
    local id, x1, y1, x2, y2, owner =
      string.match(m, '([^|]+)|(%d+)|(%d+)|(%d+)|(%d+)|([^|]+)')
    if id and x >= tonumber(x1) and x <= tonumber(x2)
       and y >= tonumber(y1) and y <= tonumber(y2) and owner ~= ARGV[1] then
      return {'ERR_ZONE_LOCKED', id}
    end
  end
end

-- od ove tačke nema ranijeg povratka: izvršavaju se svi upisi
local idx = y * width + x
-- upis boje u bajt piksela
redis.call('BITFIELD', KEYS[1], 'SET', 'u8', '#' .. idx, ARGV[5])

local appliedCooldown = 0
if not isAdmin and cooldownMs > 0 then
  -- cooldown: ključ koji sam ističe posle cooldownMs
  redis.call('SET', KEYS[3], '1', 'PX', cooldownMs)
  appliedCooldown = cooldownMs
end

-- nova verzija platna
local version = redis.call('INCR', KEYS[6])
-- red poteza za worker koji ih upisuje u cassandru
local streamId = redis.call('XADD', KEYS[5], '*',
  'uid', ARGV[1], 'u', ARGV[2], 'x', ARGV[3], 'y', ARGV[4], 'c', ARGV[5])

-- obaveštenje svim api instancama
redis.call('PUBLISH', KEYS[8], version .. ',' .. ARGV[3] .. ',' .. ARGV[4] .. ',' .. ARGV[5])
return {'OK', streamId, version, appliedCooldown}
