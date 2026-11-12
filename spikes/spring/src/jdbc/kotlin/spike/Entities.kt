package spike
import org.springframework.data.annotation.Id
import org.springframework.data.relational.core.mapping.Table
import org.springframework.data.repository.CrudRepository

@Table("rooms") data class Room(@Id val id: Long? = null, val title: String)
@Table("anonymous_users") data class AnonymousUser(@Id val id: Long? = null, val alias: String)
@Table("participants") data class Participant(@Id val id: Long? = null, val roomId: Long, val anonymousUserId: Long)
interface RoomRepository : CrudRepository<Room, Long>
interface ParticipantRepository : CrudRepository<Participant, Long>
interface AnonymousUserRepository : CrudRepository<AnonymousUser, Long>
