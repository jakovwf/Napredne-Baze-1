import { Global, Module } from '@nestjs/common';
import { LuaScriptsService } from './lua-scripts.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, LuaScriptsService],
  exports: [RedisService, LuaScriptsService],
})
export class RedisModule {}
