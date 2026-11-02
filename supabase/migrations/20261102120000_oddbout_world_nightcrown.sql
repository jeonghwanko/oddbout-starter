-- NIGHTCROWN (2026-11-02): the second official world (owner_id null), for the four witches of the girl group NIGHTCROWN.
-- The site carries the world's lore in three languages (crashbang-heroes kaito_web/src/platform/worldLore.ts and its string tables) and the art
-- under /art/worlds/nightcrown/; this row is the Korean name, tagline, place and short description, like Kkumssi's seed.
-- No factions: the lore tells the rival group, and a faction name would show untranslated on the English and Japanese pages.
insert into public.af_worlds(id, name, description, tagline, place, cover_path, published) values
 ('nightcrown', '나이트크라운',
  '마왕성의 간부 네 마녀가 순회 공연을 떠났다. 한눈에는 곧 싸움이 날 것 같지만, 꺼내는 것은 정확한 화음과 군무다. 명령으로 얻는 복종과 스스로 보내는 박수가 다르다는 것을, 이들은 무대에서 처음 배운다.',
  E'무릎 말고 박수,\n네가 원할 때.', '마왕성 순회 공연', '/art/worlds/nightcrown/cover.webp', true);

-- The cast, placed by the operator (placed_by null locks them in the world). A fighter missing from this database (a fresh test database) is
-- left out; one already placed in another world stops the migration — that is a decision for a person, not a move made here.
-- placed_at spaced by a millisecond: now() is one instant in a transaction, and the world page lists the cast in placing order.
insert into public.af_world_fighters(fighter_id, world_id, name, portrait_path, placed_at)
select v.id, 'nightcrown', v.name, v.portrait, now() + v.place * interval '1 millisecond'
from (values
  ('d6181c94-77b7-4e28-b457-b9adbcce523f'::uuid, '벨로라', '/art/worlds/nightcrown/velora-face.webp', 1),
  ('164cf916-a394-4344-9027-aaa88d6cb5a0'::uuid, '네라', '/art/worlds/nightcrown/nera-face.webp', 2),
  ('47ba0ae7-664d-45f7-8f7f-7b0250f8192f'::uuid, '루비아', '/art/worlds/nightcrown/rubia-face.webp', 3),
  ('b3578706-48d5-4c0a-bcee-f7e84f74d584'::uuid, '모른', '/art/worlds/nightcrown/morne-face.webp', 4)
) v(id, name, portrait, place)
join public.af_fighters f on f.id = v.id;
