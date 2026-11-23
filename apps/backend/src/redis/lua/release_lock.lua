-- numberOfKeys: 1
-- oslobađa lock samo ako ga još drži pozivalac (ARGV[1] je token vlasnika);
-- bez provere vlasnika, instanca čiji je lock istekao obrisala bi tuđi lock
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
