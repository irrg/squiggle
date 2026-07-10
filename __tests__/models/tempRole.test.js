import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Sequelize } from "sequelize";
import TempRoleModel from "../../src/models/tempRole.js";

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
});
const TempRole = TempRoleModel(sequelize);

const base = {
  guildId: "guild-1",
  memberId: "member-1",
  memberName: "testuser",
  roleId: "role-1",
  roleName: "Cool Person",
  messageId: "msg-1",
};

beforeAll(async () => {
  await TempRole.sync({ force: true });
});

beforeEach(async () => {
  await TempRole.destroy({ where: {}, truncate: true });
});

describe("TempRole model", () => {
  it("creates a record with all fields", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    const record = await TempRole.create({ ...base, expirationTime });

    expect(record.id).toBeDefined();
    expect(record.guildId).toBe("guild-1");
    expect(record.memberId).toBe("member-1");
    expect(record.roleId).toBe("role-1");
    expect(record.expirationTime).toBeInstanceOf(Date);
  });

  it("finds a record by composite fields", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    await TempRole.create({ ...base, expirationTime });

    const found = await TempRole.findOne({
      where: { guildId: "guild-1", memberId: "member-1", messageId: "msg-1" },
    });

    expect(found).not.toBeNull();
    expect(found.roleName).toBe("Cool Person");
  });

  it("updates expiration time", async () => {
    const initial = new Date(Date.now() + 60 * 60 * 1000);
    const record = await TempRole.create({ ...base, expirationTime: initial });

    const extended = new Date(initial.getTime() + 4 * 60 * 60 * 1000);
    await record.update({ expirationTime: extended });
    await record.reload();

    expect(record.expirationTime.getTime()).toBe(extended.getTime());
  });

  it("destroys by id", async () => {
    const record = await TempRole.create({
      ...base,
      expirationTime: new Date(),
    });
    await TempRole.destroy({ where: { id: record.id } });

    expect(await TempRole.count()).toBe(0);
  });

  it("finds all records past expiration", async () => {
    const expired = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    await TempRole.create({ ...base, expirationTime: expired });
    await TempRole.create({
      ...base,
      messageId: "msg-2",
      expirationTime: future,
    });

    const { Op } = await import("sequelize");
    const results = await TempRole.findAll({
      where: { expirationTime: { [Op.lt]: new Date() } },
    });

    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("msg-1");
  });
});
